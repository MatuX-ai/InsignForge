/**
 * 离线结构校验 —— 不依赖任何 npm 包
 *
 * 仅使用 node:fs / node:path 验证:
 * 1. 关键文件存在
 * 2. package.json 关键字段
 * 3. cordis.patch.yml 语法(用正则粗略检查)
 * 4. 目录结构完整
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); console.error(`  [FAIL] ${msg}`); }
function warn(msg) { warnings.push(msg); console.warn(`  [WARN] ${msg}`); }
function ok(msg) { console.log(`  [ OK ] ${msg}`); }
function section(title) { console.log(`\n--- ${title} ---`); }

console.log('\n=== InsightForge dsh Plugin 结构校验(离线) ===\n');

// 1. 关键文件存在性
section('1. 关键文件');
const requiredFiles = [
  'package.json',
  'cordis.patch.yml',
  'tsconfig.json',
  'LICENSE',
  'README.md',
  '.gitignore',
  'src/index.ts',
  'src/client.ts',
  'src/config.ts',
  'src/config-types.ts',
  'src/types.ts',
  'src/logger.ts',
  'types/dsh.d.ts',
  'scripts/build.mjs',
  'scripts/release.mjs',
  'scripts/verify-bundle.mjs',
  'docs/API.md',
  'docs/CHANGELOG.md',
  'docs/cordis.yml.example',
  'docs/ANNOUNCEMENT.md',
  'tests/tools.test.ts',
  'tests/integration.test.ts',
  'tests/fixtures/sample-report.json',
];
for (const rel of requiredFiles) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    fail(`缺失文件: ${rel}`);
  } else {
    ok(`${rel} (${statSync(p).size} bytes)`);
  }
}

// 2. core / tools / services 子目录
section('2. 核心目录文件');
const coreFiles = [
  'core/researcher.ts',
  'core/db.ts',
  'core/db-schema.ts',
  'core/llm.ts',
  'core/aggregator.ts',
  'core/open-serp.ts',
  'core/hacker-news.ts',
  'core/reddit.ts',
  'core/landing.ts',
  'core/cache.ts',
  'core/concurrency.ts',
  'core/schemas/report.ts',
  'core/prompts/keyword-extractor.ts',
  'core/prompts/report-generator.ts',
];
for (const rel of coreFiles) {
  const p = join(ROOT, 'src', rel);
  if (!existsSync(p)) fail(`缺失: src/${rel}`);
  else ok(`src/${rel}`);
}

const toolFiles = ['market-research.ts', 'search-demand.ts', 'generate-landing.ts', 'competitor.ts'];
for (const rel of toolFiles) {
  const p = join(ROOT, 'src/tools', rel);
  if (!existsSync(p)) fail(`缺失: src/tools/${rel}`);
  else ok(`src/tools/${rel}`);
}

const serviceFiles = ['demand-service.ts', 'report-service.ts', 'session-service.ts'];
for (const rel of serviceFiles) {
  const p = join(ROOT, 'src/services', rel);
  if (!existsSync(p)) fail(`缺失: src/services/${rel}`);
  else ok(`src/services/${rel}`);
}

// 3. package.json 关键字段
section('3. package.json 字段');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.name !== 'insightforge-dsh-plugin') fail(`name 应为 insightforge-dsh-plugin,实际 ${pkg.name}`);
else ok(`name = ${pkg.name}`);

if (pkg.version !== '0.1.0') warn(`version 应为 0.1.0,实际 ${pkg.version}`);
else ok(`version = ${pkg.version}`);

if (pkg.type !== 'module') fail(`type 应为 module`);
else ok(`type = module`);

if (!pkg.dsh?.bundle?.patch) fail('dsh.bundle.patch 缺失');
else ok(`dsh.bundle.patch = ${pkg.dsh.bundle.patch}`);

if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform 应为 web');
else ok('dsh.client.platform = web');

const peers = pkg.peerDependencies ?? {};
for (const p of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery']) {
  if (!peers[p]) fail(`peerDependencies.${p} 缺失`);
  else ok(`peerDependencies.${p} = ${peers[p]}`);
}

if (!pkg.exports?.['./client']) fail('exports["./client"] 缺失');
else ok(`exports["./client"] = ${JSON.stringify(pkg.exports['./client'])}`);

if (!pkg.exports?.['.']) fail('exports["."] 缺失');
else ok(`exports["."] = ${JSON.stringify(pkg.exports['.'])}`);

// 4. cordis.patch.yml 文本粗略校验
section('4. cordis.patch.yml');
const patchPath = join(ROOT, pkg.dsh.bundle.patch);
const patchContent = readFileSync(patchPath, 'utf8');
if (!/plugins:/.test(patchContent)) fail('cordis.patch.yml 缺少 plugins 字段');
else ok('含 plugins 字段');
if (!/insightforge-plugin:/.test(patchContent)) fail('cordis.patch.yml 缺少 insightforge-plugin 节点');
else ok('含 insightforge-plugin 节点');
if (!/llmProvider:/.test(patchContent)) warn('cordis.patch.yml 未示例 llmProvider 配置');
else ok('含 llmProvider 示例');

// 5. Host 入口 src/index.ts 关键导出
section('5. Host 入口导出');
const indexContent = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
for (const sym of ['export const name', 'export const inject', 'export function apply', 'export { Config }']) {
  if (!indexContent.includes(sym)) fail(`src/index.ts 缺少 ${sym}`);
  else ok(`导出: ${sym}`);
}
if (!/ctx\.tools\.register/.test(indexContent)) fail('apply 中未调用 ctx.tools.register');
else ok('apply 调用 ctx.tools.register');
if (!/ctx\.provide/.test(indexContent)) fail('apply 中未调用 ctx.provide');
else ok('apply 调用 ctx.provide');

// 6. Client 入口关键内容
section('6. Client 入口');
const clientContent = readFileSync(join(ROOT, 'src/client.ts'), 'utf8');
if (!clientContent.includes("export const name = 'insightforge-client'")) {
  warn('Client name 与期望不一致');
} else ok('Client name 正确');
if (!/ctx\.shell\.command\.register/.test(clientContent)) {
  fail('Client 未注册 slash command');
} else ok('Client 注册 slash command');
if (!/ctx\.shell\.action\.register/.test(clientContent)) {
  fail('Client 未注册 action');
} else ok('Client 注册 action');

// 7. Config schema 关键字段
section('7. config.ts schema');
const configContent = readFileSync(join(ROOT, 'src/config.ts'), 'utf8');
const configFields = [
  'llmProvider', 'llmApiKey', 'searchProvider', 'searchEndpoint',
  'dbPath', 'cacheEnabled', 'maxConcurrent',
];
for (const f of configFields) {
  if (!configContent.includes(f)) fail(`config.ts 缺少字段 ${f}`);
  else ok(`字段: ${f}`);
}

// 8. 工具列表
section('8. 4 个核心工具');
const expectedTools = ['market_research', 'search_demand', 'generate_landing', 'competitor_analysis'];
for (const t of expectedTools) {
  let found = false;
  // 检查工具文件本身
  for (const toolFile of toolFiles) {
    const tc = readFileSync(join(ROOT, 'src/tools', toolFile), 'utf8');
    if (tc.includes(`name: '${t}'`) || tc.includes(`name: "${t}"`) || tc.includes(`'${t}'`)) {
      found = true;
      break;
    }
  }
  if (!found) fail(`未找到工具 ${t}`);
  else ok(`工具存在: ${t}`);
}

// 9. 3 个服务
section('9. 3 个服务');
const expectedServices = ['insightforge/demand', 'insightforge/report', 'insightforge/session'];
for (const svc of expectedServices) {
  let found = false;
  for (const sf of serviceFiles) {
    const sc = readFileSync(join(ROOT, 'src/services', sf), 'utf8');
    if (sc.includes(svc)) {
      found = true;
      break;
    }
  }
  // 也检查 index.ts
  if (!found && indexContent.includes(svc)) found = true;
  if (!found) fail(`未找到服务 ${svc}`);
  else ok(`服务存在: ${svc}`);
}

// 10. README 内容
section('10. README 内容');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
for (const kw of ['InsightForge', '安装', '配置', 'market_research', 'cordis.yml', 'FAQ']) {
  if (!readme.includes(kw)) fail(`README 缺少关键词: ${kw}`);
  else ok(`README 含 ${kw}`);
}

// 总结
console.log(`\n=== 校验完成:${errors.length} 错误,${warnings.length} 警告 ===\n`);
if (errors.length > 0) {
  process.exit(1);
}
process.exit(0);