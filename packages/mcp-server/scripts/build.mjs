#!/usr/bin/env node
/**
 * @insightforge/mcp-server 构建脚本
 *
 * 步骤:
 *   1. 清理 dist/
 *   2. tsc 生成 ESM (dist/*.js)
 *   3. esbuild 把所有 dist/*.js 转换为同名的 *.cjs(format=cjs,platform=node)
 *      - 项目内 ./X.js / ../X.js 的 require/from 引用改写为 ./X.cjs / ../X.cjs
 *      - 外部包(以非 ./ ../ 开头)require/from 中的 .cjs 还原为 .js
 *   4. tsc 生成类型定义 (dist/*.d.ts)
 *
 * 设计要点:
 * - 不用 tsc -p tsconfig.cjs.json 的原因:@modelcontextprotocol/sdk 1.30 的 conditional exports
 *   在 tsc moduleResolution=Node 下解析时会出现循环 / 死锁,长时间无响应(已实测 ~120s+ 仍无输出)。
 *   esbuild 直接走 bundler-style 解析,毫秒级完成,且对外部依赖做 external 处理。
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const require = createRequire(import.meta.url);

/**
 * @param {string} cmd
 */
function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
}

/**
 * 递归收集目录中所有 .js 文件(相对路径)。
 *
 * @param {string} dir
 * @param {string} [base]
 * @returns {Array<{ abs: string, rel: string }>}
 */
function collectJsFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(p, base));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push({ abs: p, rel: p.slice(base.length + 1) });
    }
  }
  return out;
}

/**
 * 修复 esbuild --outExtension=.cjs 带来的副作用：
 * 1. 对项目内的相对路径 `./X.js` → `./X.cjs`（上面已处理）
 * 2. 对外部包（路径以非 ./ ../ 开头）的 require/from 中的 `.cjs` → `.js`
 *    因为 esbuild 把所有 .js 都改成了 .cjs,但 node_modules 里只有 .js
 *
 * 因为 dist/ 的 package.json 是 type=module,如果 CJS 文件继续 require('./X.js')
 * Node 会尝试把 X.js 当 ESM 加载并抛 ERR_REQUIRE_ESM。
 */
function rewriteCjsReferences(distDir) {
  const files = collectJsFiles(distDir).filter((f) => f.rel.endsWith('.js'));
  // 仅处理 .cjs 文件
  const cjsFiles = files
    .map((f) => ({
      abs: f.abs.replace(/\.js$/, '.cjs'),
      rel: f.rel.replace(/\.js$/, '.cjs'),
    }))
    .filter((f) => {
      try {
        return statSync(f.abs).isFile();
      } catch {
        return false;
      }
    });

  let totalRewrites = 0;
  let externalReverts = 0;
  for (const f of cjsFiles) {
    let content = readFileSync(f.abs, 'utf8');
    const dirOfThisFile = dirname(f.abs);

    // ===== 1. 项目内相对路径：./X.js / ../X.js -> ./X.cjs / ../X.cjs =====
    content = content.replace(
      /(require\s*\(\s*['"])([^'"]+?)\.js(['"]\s*\))/g,
      (match, p1, p2, p3) => {
        const target = resolve(dirOfThisFile, `${p2}.js`);
        if (target.startsWith(distDir + sep) || target.startsWith(distDir)) {
          totalRewrites++;
          return `${p1}${p2}.cjs${p3}`;
        }
        return match;
      },
    );

    content = content.replace(
      /(from\s+['"])([^'"]+?)\.js(['"])/g,
      (match, p1, p2, p3) => {
        const target = resolve(dirOfThisFile, `${p2}.js`);
        if (target.startsWith(distDir + sep) || target.startsWith(distDir)) {
          totalRewrites++;
          return `${p1}${p2}.cjs${p3}`;
        }
        return match;
      },
    );

    // ===== 2. 外部包：'@scope/name/...cjs' 或 'foo/bar.cjs' -> 还原为 .js =====
    // esbuild 会把所有 require/from 中的 .js 都改成 .cjs,但外部依赖的实际文件是 .js
    // 匹配形如 require("xxx.cjs") / from "xxx.cjs",其中 xxx 不是以 ./ 或 ../ 开头
    content = content.replace(
      /(require\s*\(\s*['"])([^'".][^'"]*?)\.cjs(['"]\s*\))/g,
      (match, p1, p2, p3) => {
        externalReverts++;
        return `${p1}${p2}.js${p3}`;
      },
    );
    content = content.replace(
      /(from\s+['"])([^'".][^'"]*?)\.cjs(['"])/g,
      (match, p1, p2, p3) => {
        externalReverts++;
        return `${p1}${p2}.js${p3}`;
      },
    );

    writeFileSync(f.abs, content);
  }
  return { rewrittenFiles: cjsFiles.length, totalRewrites, externalReverts };
}

/**
 * 用 esbuild 把 ESM dist/*.js 转换为同名的 .cjs(format=cjs,platform=node)。
 * 外部依赖(@modelcontextprotocol/sdk / express / pino / zod / @insightforge/core)保持 external。
 */
function buildCjsViaEsbuild() {
  const esbuild = loadEsbuild();
  const jsFiles = collectJsFiles(distDir).map((f) => f.abs);
  if (jsFiles.length === 0) {
    throw new Error('No .js files found in dist/. Run ESM build first.');
  }
  const result = esbuild.buildSync({
    entryPoints: jsFiles,
    outdir: distDir,
    outExtension: { '.js': '.cjs' },
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    bundle: false,
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
  });
  if (result.errors.length > 0) {
    throw new Error(
      `esbuild failed: ${result.errors.map((e) => e.text).join('\n')}`,
    );
  }
  return jsFiles.length;
}

function loadEsbuild() {
  // ESM 上下文,用 createRequire() 加载 CommonJS 包
  try {
    return require('esbuild');
  } catch (e1) {
    try {
      // workspaces 提升到根 node_modules 时,从仓库根找
      return require(resolve(root, '..', '..', 'node_modules', 'esbuild'));
    } catch (e2) {
      throw new Error(
        `esbuild not found: ${e1.message}; ${e2.message}. Run \`npm install\` at the repo root.`,
      );
    }
  }
}

console.log('=== Building @insightforge/mcp-server ===\n');

// 1. 清理
console.log('[1/5] 清理旧产物');
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// 2. ESM
console.log('[2/5] 生成 ESM -> dist/index.js');
run('npx tsc -p tsconfig.esm.json');

// 3. CJS via esbuild(避免 tsc CommonJS 解析 SDK 时死锁)
console.log('[3/5] 生成 CJS -> dist/*.cjs (esbuild)');
const cjsCount = buildCjsViaEsbuild();
const { rewrittenFiles, totalRewrites, externalReverts } = rewriteCjsReferences(distDir);
console.log(
  `  esbuild 转换 ${cjsCount} 个文件 + 改写 ${rewrittenFiles} 个 .cjs：内部 ${totalRewrites} 处 + 外部还原 ${externalReverts} 处`,
);

// 4. Types
console.log('[4/5] 生成类型定义 -> dist/index.d.ts');
run('npx tsc -p tsconfig.types.json');

// 5. 校验产物
console.log('\n[5/5] 最终产物:');
const outputs = ['index.js', 'index.cjs', 'index.d.ts'];
for (const f of outputs) {
  const p = resolve(distDir, f);
  const s = statSync(p, { throwIfNoEntry: false });
  if (s) {
    console.log(`  ${f.padEnd(14)} ${s.size} bytes`);
  } else {
    console.error(`  ${f.padEnd(14)} MISSING`);
    process.exit(1);
  }
}

console.log('\n✓ Build complete!');