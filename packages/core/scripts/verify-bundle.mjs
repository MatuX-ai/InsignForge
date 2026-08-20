/**
 * 校验 @insightforge/core 构建产物
 *
 * 验证项:
 * 1. package.json 字段完整性(name / version / exports / main / module / types)
 * 2. exports["."] 双格式(import + require)
 * 3. 关键 scripts(build / test / typecheck)
 * 4. 依赖完整性(zod / pino / openai / better-sqlite3)
 * 5. engines.node 声明
 * 6. 构建产物存在性(dist/index.{js,cjs,d.ts}),存在时打印字节数
 *
 * 非破坏性校验:失败时打印错误并退出 1,但不修改任何文件。
 * 在 build 前运行也可以(产物检查会跳过,其它会校验)。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
  console.error(`  [FAIL] ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
  console.warn(`  [WARN] ${msg}`);
}
function ok(msg) {
  console.log(`  [ OK ] ${msg}`);
}

console.log('\n=== 校验 @insightforge/core 包 ===\n');

// 1. 读取 package.json
const pkgPath = resolve(ROOT, 'package.json');
if (!existsSync(pkgPath)) {
  fail(`package.json 不存在: ${pkgPath}`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
ok(`package.json 加载成功 (${pkg.name}@${pkg.version})`);

// 2. 校验基础字段
if (!pkg.name || !pkg.name.startsWith('@insightforge/')) {
  fail(`name 应以 @insightforge/ 开头,实际为 ${pkg.name}`);
} else {
  ok(`name = ${pkg.name}`);
}

if (!pkg.version) {
  fail('version 字段缺失');
} else {
  ok(`version = ${pkg.version}`);
}

if (pkg.type !== 'module') {
  fail(`type 应为 "module",实际为 ${pkg.type}`);
} else {
  ok('type = module (ESM 优先)');
}

if (pkg.main !== './dist/index.cjs') {
  fail(`main 应为 "./dist/index.cjs",实际为 ${pkg.main}`);
} else {
  ok('main = ./dist/index.cjs');
}

if (pkg.module !== './dist/index.js') {
  fail(`module 应为 "./dist/index.js",实际为 ${pkg.module}`);
} else {
  ok('module = ./dist/index.js');
}

if (pkg.types !== './dist/index.d.ts') {
  fail(`types 应为 "./dist/index.d.ts",实际为 ${pkg.types}`);
} else {
  ok('types = ./dist/index.d.ts');
}

// 3. 校验 exports["."]
const mainExport = pkg.exports?.['.'];
if (!mainExport) {
  fail('exports["."] 缺失');
} else {
  if (typeof mainExport === 'string') {
    fail('exports["."] 应为对象(支持 import/require 双格式)');
  } else {
    if (!mainExport.import) fail('exports["."].import 缺失');
    else ok(`exports["."].import = ${mainExport.import}`);
    if (!mainExport.require) fail('exports["."].require 缺失');
    else ok(`exports["."].require = ${mainExport.require}`);
    if (!mainExport.types) fail('exports["."].types 缺失');
    else ok(`exports["."].types = ${mainExport.types}`);
  }
}

// 4. 校验 scripts
const requiredScripts = ['build', 'test', 'typecheck', 'clean'];
for (const s of requiredScripts) {
  if (!pkg.scripts?.[s]) {
    fail(`scripts.${s} 缺失`);
  } else {
    ok(`scripts.${s} = ${pkg.scripts[s]}`);
  }
}

// 5. 校验依赖
const requiredDeps = ['zod', 'pino', 'openai', 'better-sqlite3'];
for (const d of requiredDeps) {
  if (!pkg.dependencies?.[d]) {
    fail(`dependencies.${d} 缺失`);
  } else {
    ok(`dependencies.${d} = ${pkg.dependencies[d]}`);
  }
}

const requiredDevDeps = ['vitest', 'typescript', 'tsx', 'rimraf'];
for (const d of requiredDevDeps) {
  if (!pkg.devDependencies?.[d]) {
    fail(`devDependencies.${d} 缺失`);
  } else {
    ok(`devDependencies.${d} = ${pkg.devDependencies[d]}`);
  }
}

// 6. 校验 engines.node
const nodeEngine = pkg.engines?.node;
if (!nodeEngine || !nodeEngine.includes('22')) {
  warn(`engines.node 应包含 22,实际为 ${nodeEngine}`);
} else {
  ok(`engines.node = ${nodeEngine}`);
}

// 7. 校验构建产物(若 dist/ 已存在)
const distDir = resolve(ROOT, 'dist');
if (!existsSync(distDir)) {
  warn('dist/ 目录不存在,跳过产物校验(运行 npm run build)');
} else {
  const expected = ['index.js', 'index.cjs', 'index.d.ts'];
  for (const f of expected) {
    const p = resolve(distDir, f);
    if (!existsSync(p)) {
      fail(`构建产物缺失: dist/${f}`);
    } else {
      const size = statSync(p).size;
      if (size === 0) fail(`dist/${f} 为空文件`);
      else ok(`dist/${f} (${size} bytes)`);
    }
  }
}

// 8. 校验源文件清单
const requiredSrc = [
  'src/index.ts',
  'src/researcher.ts',
  'src/config.ts',
  'src/config-types.ts',
  'src/landing.ts',
  'src/logger.ts',
  'src/cache.ts',
  'src/concurrency.ts',
  'src/db.ts',
  'src/db-schema.ts',
  'src/aggregator.ts',
  'src/llm.ts',
  'src/types.ts',
  'src/open-serp.ts',
  'src/hacker-news.ts',
  'src/reddit.ts',
  'src/schemas/report.ts',
  'src/prompts/index.ts',
  'src/prompts/keyword-extractor.ts',
  'src/prompts/report-generator.ts',
];
for (const f of requiredSrc) {
  const p = resolve(ROOT, f);
  if (!existsSync(p)) {
    fail(`源文件缺失: ${f}`);
  } else {
    ok(f);
  }
}

console.log(`\n=== 校验完成:${errors.length} 错误,${warnings.length} 警告 ===\n`);
if (errors.length > 0) {
  process.exit(1);
}
process.exit(0);