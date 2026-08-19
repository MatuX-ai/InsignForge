/**
 * 校验 Bundle 配置 —— 文档 4.5 节
 *
 * 验证项:
 * 1. package.json 含 dsh.bundle.patch 字段
 * 2. cordis.patch.yml 文件存在且可解析
 * 3. peerDependencies 含 @deepseek-ai/cordis / dsh-tools / schemastery
 * 4. exports["./client"] 指向存在的构建产物
 * 5. 主入口 dist/index.js 存在
 *
 * 非破坏性校验:失败时打印错误并退出 1,但不修改任何文件。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

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

console.log('\n=== 校验 insightforge-dsh-plugin Bundle ===\n');

// 1. 读取 package.json
const pkgPath = resolve(ROOT, 'package.json');
if (!existsSync(pkgPath)) {
  fail(`package.json 不存在: ${pkgPath}`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
ok(`package.json 版本 ${pkg.version} 加载成功`);

// 2. 校验 dsh.bundle.patch
const bundlePatch = pkg.dsh?.bundle?.patch;
if (!bundlePatch) {
  fail('package.json 缺少 dsh.bundle.patch 字段');
} else {
  const patchPath = resolve(ROOT, bundlePatch);
  if (!existsSync(patchPath)) {
    fail(`cordis.patch.yml 不存在: ${patchPath}`);
  } else {
    try {
      const yamlContent = readFileSync(patchPath, 'utf8');
      const parsed = YAML.parse(yamlContent);
      if (!parsed?.plugins?.['insightforge-plugin']) {
        fail(`cordis.patch.yml 缺少 plugins.insightforge-plugin 节点`);
      } else {
        ok(`cordis.patch.yml 解析成功,声明 plugins.insightforge-plugin`);
      }
    } catch (err) {
      fail(`cordis.patch.yml 解析失败: ${err.message}`);
    }
  }
}

// 3. 校验 peerDependencies
const peers = pkg.peerDependencies ?? {};
const requiredPeers = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery'];
for (const peer of requiredPeers) {
  if (!peers[peer]) {
    fail(`peerDependencies 缺少 ${peer}`);
  } else {
    ok(`peerDependencies.${peer} = ${peers[peer]}`);
  }
}

// 4. 校验 exports["./client"]
const clientExport = pkg.exports?.['./client'];
if (!clientExport) {
  fail('exports["./client"] 缺失');
} else {
  // exports 可能是 string 或 { import: '...' }
  const clientPath = typeof clientExport === 'string'
    ? clientExport
    : clientExport.import ?? clientExport.default;
  const clientFullPath = resolve(ROOT, clientPath);
  if (!existsSync(clientFullPath)) {
    warn(`Client 入口 ${clientPath} 不存在(可能尚未 build;运行 pnpm build 生成)`);
  } else {
    ok(`exports["./client"] = ${clientPath} (${statSync(clientFullPath).size} bytes)`);
  }
}

// 5. 校验主入口
const mainEntry = pkg.exports?.['.'];
if (!mainEntry) {
  fail('exports["."] 缺失');
} else {
  const mainPath = typeof mainEntry === 'string'
    ? mainEntry
    : mainEntry.import ?? mainEntry.default;
  const mainFullPath = resolve(ROOT, mainPath);
  if (!existsSync(mainFullPath)) {
    warn(`Host 入口 ${mainPath} 不存在(运行 pnpm build 生成)`);
  } else {
    ok(`exports["."] = ${mainPath} (${statSync(mainFullPath).size} bytes)`);
  }
}

// 6. 校验 dsh.client.platform (文档 4.5)
if (pkg.dsh?.client?.platform !== 'web') {
  fail('dsh.client.platform 应为 "web"');
} else {
  ok('dsh.client.platform = web');
}

// 7. 校验 Node 版本要求
const nodeEngine = pkg.engines?.node;
if (!nodeEngine || !nodeEngine.includes('22')) {
  warn(`engines.node 应包含 22,实际为 ${nodeEngine}`);
} else {
  ok(`engines.node = ${nodeEngine}`);
}

console.log(`\n=== 校验完成:${errors.length} 错误,${warnings.length} 警告 ===\n`);
if (errors.length > 0) {
  process.exit(1);
}
process.exit(0);