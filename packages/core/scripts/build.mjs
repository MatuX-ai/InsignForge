#!/usr/bin/env node
/**
 * @insightforge/core 构建脚本
 *
 * 步骤:
 *   1. 清理 dist/ dist-cjs/ dist-types/
 *   2. tsc 生成 ESM (dist/index.js)
 *   3. tsc 生成 CJS (dist-cjs/*.js) → 重命名为 *.cjs 并写入 dist/
 *      同时改写文件内对 .js 的引用为 .cjs(解决 type=module + tsc CommonJS 的引用不一致)
 *   4. tsc 生成类型定义 (dist/index.d.ts)
 *
 * 设计要点:
 * - type=module 时 Node 把 .js 视为 ESM,因此 CJS 必须用 .cjs 扩展名
 * - ESM 与 CJS 分目录构建,避免相互覆盖
 * - 重命名通过 fs.renameSync 同步执行;引用改写通过 readFileSync + writeFileSync
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const distCjsDir = resolve(root, 'dist-cjs');
const distTypesDir = resolve(root, 'dist-types');

/**
 * @param {string} cmd
 */
function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

/**
 * 递归收集目录中所有 .js 文件
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
 * 改写 CJS 文件中对 .js 的 require/import 引用为 .cjs
 */
function rewriteCjsReferences(srcDir, dstDir) {
  const files = collectJsFiles(srcDir);
  for (const f of files) {
    let content = readFileSync(f.abs, 'utf8');

    // 处理 require("./xxx.js") / require('../xxx.js')
    content = content.replace(
      /(require\s*\(\s*['"])([^'"]+?)\.js(['"]\s*\))/g,
      (_, p1, p2, p3) => `${p1}${p2}.cjs${p3}`
    );

    // 处理 import ... from "./xxx.js"
    content = content.replace(
      /(from\s+['"])([^'"]+?)\.js(['"])/g,
      (_, p1, p2, p3) => `${p1}${p2}.cjs${p3}`
    );

    // 处理 __importStar 等动态 require 场景(少见,保守处理)
    // 此处暂不处理 __importStar,因为 tsc CJS 输出不依赖它

    const newName = f.rel.replace(/\.js$/, '.cjs');
    const target = resolve(dstDir, newName);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

console.log('=== Building @insightforge/core ===\n');

// 1. 清理
console.log('[1/5] 清理旧产物');
rmSync(distDir, { recursive: true, force: true });
rmSync(distCjsDir, { recursive: true, force: true });
rmSync(distTypesDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// 2. ESM
console.log('[2/5] 生成 ESM -> dist/index.js');
run('npx tsc -p tsconfig.esm.json');

// 3. CJS(输出到临时目录,改写后写入 dist/)
console.log('[3/5] 生成 CJS -> dist-cjs/ (改写引用 + 重命名为 *.cjs 后写入 dist/)');
run('npx tsc -p tsconfig.cjs.json');
rewriteCjsReferences(distCjsDir, distDir);
rmSync(distCjsDir, { recursive: true, force: true });

// 4. Types
console.log('[4/5] 生成类型定义 -> dist/index.d.ts');
run('npx tsc -p tsconfig.types.json');

// 5. 校验产物
console.log('\n[5/5] 最终产物:');
const outputs = ['index.js', 'index.cjs', 'index.d.ts'];
for (const f of outputs) {
  const p = resolve(distDir, f);
  if (statSync(p, { throwIfNoEntry: false })) {
    console.log(`  ${f.padEnd(14)} ${statSync(p).size} bytes`);
  } else {
    console.error(`  ${f.padEnd(14)} MISSING`);
    process.exit(1);
  }
}

console.log('\n✓ Build complete!');