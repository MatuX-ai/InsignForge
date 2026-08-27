/**
 * InsightForge 桌面版构建脚本
 *
 * 流程:
 *   1. 递增版本号 (仅 --dist 模式)
 *   2. 编译后端 + 前端
 *   3. 组装 resources/backend (同步 package.json + 按需补齐 node_modules + 更新 dist)
 *   4. 检查 better-sqlite3 ABI (调用 patch_bs.cjs 补丁)
 *   5. 组装 frontend-dist
 *   6. electron-builder 打包
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DESKTOP = __dirname;
const RESOURCES = path.join(DESKTOP, 'resources');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function step(msg) { console.log(`\n=== ${msg} ===`); }
function run(cmd, cwd) {
  console.log(`> ${cmd}  (cwd: ${cwd})`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit', shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash' });
  } catch (err) {
    // 透传真实错误信息(原 execSync 默认会吞掉 stdout/stderr)
    console.error(`\n❌ 命令执行失败: ${cmd}`);
    if (err.stdout) console.error(`[stdout]\n${err.stdout.toString()}`);
    if (err.stderr) console.error(`[stderr]\n${err.stderr.toString()}`);
    if (err.message) console.error(`[message] ${err.message}`);
    process.exit(err.status ?? 1);
  }
}

// ---------- 递增版本号 (仅 --dist 模式) ----------
if (process.argv.includes('--dist')) {
  step('0/6 递增版本号');
  const pkgPath = path.join(DESKTOP, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const newVersion = `${major}.${minor}.${patch + 1}`;
  console.log(`  ${pkg.version} → ${newVersion}`);
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// ---------- 编译 ----------
step('1/6 编译');
run(`${NPM} run build`, path.join(ROOT, 'backend'));
run(`${NPM} run build`, path.join(ROOT, 'frontend'));

// ---------- 组装 backend ----------
step('2/6 组装 backend resources');
const backendRes = path.join(RESOURCES, 'backend');
const nmDir = path.join(backendRes, 'node_modules');

// 必需的运行时依赖(必须存在,否则后端启动会报 Cannot find module)
const REQUIRED_DEPS = [
  'express', 'cors', 'openai', 'zod',
  'pino', 'puppeteer-core', 'better-sqlite3', 'dotenv',
];

// 排除的文件模式(拷贝资源时使用)
const excludePatterns = [
  'test', '__tests__', 'spec',
  '.git', '.svn',
  '.map', '.c', '.h',
  'README.md', 'CHANGELOG.md', 'LICENSE.md'
];

// 同步 package.json / lockfile,避免 lockfile 与实际包不同步
fs.cpSync(path.join(ROOT, 'backend', 'package.json'), path.join(backendRes, 'package.json'));
const rootLock = path.join(ROOT, 'backend', 'package-lock.json');
if (fs.existsSync(rootLock)) {
  fs.copyFileSync(rootLock, path.join(backendRes, 'package-lock.json'));
}

// 检测依赖完整性
const missing = REQUIRED_DEPS.filter((d) => !fs.existsSync(path.join(nmDir, d)));

if (missing.length === 0) {
  console.log('  ✅ node_modules 完整(保留现有)');
} else {
  console.log(`  ⚠️ 缺失依赖: ${missing.join(', ')}`);
  console.log('  正在安装生产依赖(--omit=dev)...');
  run(`${NPM} install --omit=dev --no-audit --no-fund`, backendRes);
}

// 仅更新 dist(不动 node_modules)
fs.rmSync(path.join(backendRes, 'dist'), { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'backend', 'dist'), path.join(backendRes, 'dist'), { recursive: true });

// ---------- 检查/修复 better-sqlite3 ABI ----------
step('3/6 检查 better-sqlite3 ABI');
const bsDir = path.join(backendRes, 'node_modules', 'better-sqlite3');
const nodeFile = path.join(bsDir, 'build', 'Release', 'better_sqlite3.node');

// Electron 33 自带 Node 20.18.3, NODE_MODULE_VERSION = 130, 对应 electron-v130 prebuilt.
const EXPECTED_ABI = 'v130';
function getAbi(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const str = fs.readFileSync(filePath).toString('latin1');
  for (const a of ['v139', 'v137', 'v131', 'v130', 'v127']) {
    if (str.includes(a)) return a;
  }
  return null;
}

const currentAbi = getAbi(nodeFile);
console.log('  当前 ABI:', currentAbi, currentAbi === EXPECTED_ABI ? `✅ Electron 33 兼容` : `❌ 需修复 (期望 ${EXPECTED_ABI})`);

if (currentAbi !== EXPECTED_ABI) {
  // 优先用 prebuild-install 下载 Electron prebuilt(CI/全新环境可复现)
  console.log('  尝试 prebuild-install 下载 Electron prebuilt...');
  try {
    execSync(
      `${NPM} exec -- prebuild-install --runtime=electron --target=33.4.11 --dist-url=https://npmmirror.com/mirrors/electron/`,
      { cwd: bsDir, stdio: 'inherit' }
    );
    if (getAbi(nodeFile) === EXPECTED_ABI) {
      console.log('  ✅ prebuild-install 修复成功');
    } else {
      console.log('  ⚠️ prebuild-install 后 ABI 仍不匹配,回退到补丁脚本');
    }
  } catch (err) {
    console.warn('  ⚠️ prebuild-install 失败,回退到补丁脚本:', err.message);
  }

  // 回退: 调用 CJS 补丁脚本(依赖本地缓存)
  const patchScript = path.join(ROOT, 'patch_bs.cjs');
  if (getAbi(nodeFile) !== EXPECTED_ABI && fs.existsSync(patchScript)) {
    console.log('  运行补丁脚本...');
    execSync(`node "${patchScript}"`, { stdio: 'inherit' });
  } else if (getAbi(nodeFile) !== EXPECTED_ABI) {
    console.log('  ⚠️ patch_bs.cjs 不存在,跳过补丁');
  }
}

// ---------- 组装 frontend ----------
step('4/6 组装 frontend resources');
const frontendRes = path.join(RESOURCES, 'frontend-dist');
fs.rmSync(frontendRes, { recursive: true, force: true });
fs.mkdirSync(frontendRes, { recursive: true });
fs.cpSync(path.join(ROOT, 'frontend', 'dist'), frontendRes, { recursive: true });

// ---------- 打包 ----------
if (process.argv.includes('--dist')) {
  step('5/7 打包 Windows 安装包');
  run(`${NPM} exec -- electron-builder --win`, DESKTOP);
} else {
  step('5/7 打包 (仅 unpacked)');
  run(`${NPM} exec -- electron-builder --dir`, DESKTOP);
}

// ---------- 嵌入图标到 InsightForge.exe ----------
// electron-builder 自带的 png2icons 可能只生成单尺寸 ICO,导致 RT_GROUP_ICON 仍指向旧条目.
// 这里手动生成多尺寸 ICO(16/24/32/48/64/128/256)并用 rcedit-x64.exe 嵌入,
// 确保 win-unpacked/InsightForge.exe 始终带新图标。
step('6/7 嵌入应用图标');
const { spawnSync } = await import('node:child_process');

function fail(msg) { console.error(`\n❌ ${msg}`); process.exit(1); }

// 6.1 生成多尺寸 ICO
const psScript = path.join(DESKTOP, 'scripts', 'make-multi-ico.ps1');
const icoOut = path.join(DESKTOP, 'dist', '.icon-ico', 'icon.ico');
console.log(`  生成多尺寸 ICO: ${icoOut}`);
const psRun = spawnSync('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript,
   '-PngPath', path.join(DESKTOP, 'build', 'icon.png'),
   '-Output', icoOut],
  { stdio: 'inherit' });
if (psRun.status !== 0) fail('make-multi-ico.ps1 失败');

// 6.2 rcedit 嵌入图标到 EXE
const rcedit = path.join(process.env.LOCALAPPDATA || process.env.HOME,
  'electron-builder', 'Cache', 'winCodeSign', '583233367', 'rcedit-x64.exe');
const exePath = path.join(DESKTOP, 'dist', 'win-unpacked', 'InsightForge.exe');

if (!fs.existsSync(rcedit)) {
  console.warn(`  ⚠️ 找不到 rcedit-x64.exe (${rcedit}),跳过嵌入步骤`);
  console.warn('     请运行 desktop/scripts/fetch-wincodesign.mjs 下载并解压');
} else if (!fs.existsSync(exePath)) {
  console.warn(`  ⚠️ 找不到 ${exePath},跳过嵌入步骤`);
} else {
  console.log(`  嵌入 ${path.basename(exePath)}`);
  const before = fs.statSync(exePath).size;
  const r = spawnSync(rcedit, [exePath, '--set-icon', icoOut], { stdio: 'inherit' });
  if (r.status !== 0) fail('rcedit 嵌入图标失败');
  const after = fs.statSync(exePath).size;
  console.log(`  ✅ 完成 (大小: ${before} → ${after})`);
}

// ---------- 清理多余图标资源 ----------
step('7/7 收尾');
// win-unpacked 里的 chrome_100_percent.pak / resources 等 Electron 资源保持原样

console.log('\n✅ 完成');
console.log(`  backend:   ${backendRes}`);
if (process.argv.includes('--dist')) {
  console.log(`  安装包:    ${path.join(DESKTOP, 'dist')}`);
}
