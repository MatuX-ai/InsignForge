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

// ---------- 生成应用图标 (icon.png + icon.ico) ----------
// ⚠️ desktop/build/ 被 .gitignore 的 '**/build/' 规则全局排除,
//   CI 上下載下来的仓库里这个目录是空的; 而 build.mjs 第 5/7 步、
//   electron-builder.yml 的 win.icon / nsis.installerIcon 都依赖
//   build/icon.png + build/icon.ico, 缺一整个 desktop job 挂掉。
//   在 build.mjs 头部一次性补齐, 保证两种环境一致:

const { spawnSync: spawnSyncTop } = await import('node:child_process');
function failTop(msg) { console.error(`\n❌ ${msg}`); process.exit(1); }

// 0.1 生成 icon.png (512x512 源图)
step('0.1/7 生成 icon.png');
const genIconScript = path.join(DESKTOP, 'scripts', 'gen-icon.mjs');
const iconPngPath = path.join(DESKTOP, 'build', 'icon.png');
if (fs.existsSync(iconPngPath)) {
  console.log('  ✅ build/icon.png 已存在,跳过生成');
} else if (fs.existsSync(genIconScript)) {
  console.log('  ⚠️ build/icon.png 缺失,运行 scripts/gen-icon.mjs 生成...');
  execSync(`node "${genIconScript}"`, { stdio: 'inherit' });
  if (!fs.existsSync(iconPngPath)) failTop(`生成失败: ${iconPngPath} 仍不存在`);
  console.log('  ✅ build/icon.png 已生成');
} else {
  failTop(`找不到 gen-icon.mjs (${genIconScript}),无法生成 icon.png`);
}

// 0.2 生成 build/icon.ico (多尺寸 16~256)
// ⚠️ 必须在 step 5/7 electron-builder 之前: electron-builder.yml 的
//   win.icon / nsis.installerIcon / nsis.uninstallerIcon 都指向它。
step('0.2/7 生成 build/icon.ico (多尺寸)');
const iconIcoPath = path.join(DESKTOP, 'build', 'icon.ico');
const distIconIcoPath = path.join(DESKTOP, 'dist', '.icon-ico', 'icon.ico');
if (fs.existsSync(iconIcoPath)) {
  console.log('  ✅ build/icon.ico 已存在,跳过生成');
} else {
  fs.mkdirSync(path.dirname(distIconIcoPath), { recursive: true });
  const psScript = path.join(DESKTOP, 'scripts', 'make-multi-ico.ps1');
  console.log(`  生成多尺寸 ICO: ${distIconIcoPath}`);
  const psRun = spawnSyncTop('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript,
     '-PngPath', iconPngPath,
     '-Output', distIconIcoPath],
    { stdio: 'inherit' });
  if (psRun.status !== 0) failTop('make-multi-ico.ps1 失败');
  fs.copyFileSync(distIconIcoPath, iconIcoPath);
  console.log('  ✅ build/icon.ico 已生成');
}

// ---------- 递增版本号 (仅 --dist 模式) ----------
// 版本号规则: major.minor.PATCH
//   - PATCH 为两位数(00~99),每次 --dist 打包 +1
//   - 当 PATCH 越过 99 时回零,minor +1,尾数补零保持两位
//   - 起始版本 0.1.00
if (process.argv.includes('--dist')) {
  step('0.5/6 递增版本号');
  const pkgPath = path.join(DESKTOP, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  const [maj, min, pat] = String(pkg.version).split('.').map((s) => Number.parseInt(s, 10));
  // 容错: 任意一段不是合法数字,统一回退到 0.1.00
  const isValid = [maj, min, pat].every(Number.isFinite);
  const major = isValid ? maj : 0;
  const minor = isValid ? min : 1;
  const patch = isValid ? pat : 0;

  let nextPatch = patch + 1;
  let nextMinor = minor;
  if (nextPatch > 99) {
    nextPatch = 0;
    nextMinor += 1;
  }

  const newVersion = `${major}.${nextMinor}.${String(nextPatch).padStart(2, '0')}`;
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
const backendPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'package.json'), 'utf8'));
const REQUIRED_DEPS = Object.keys(backendPackage.dependencies || {})
  .filter((name) => !name.startsWith('@types/'));

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
} else {
  fs.rmSync(path.join(backendRes, 'package-lock.json'), { force: true });
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

// ---------- 嵌入应用图标到 win-unpacked ----------
// ⚠️ signAndEditExecutable:false 让 electron-builder 跳过 rcedit, 我们手动补一刀.
//
// 但是只 rcedit **win-unpacked/InsightForge.exe**, 不能 rcedit NSIS / portable:
//   - NSIS 安装器 / portable 启动器都是 NSIS 框架生成的 PE, 自带 .ndata / 追加 payload
//   - rcedit v0.2.0 修改 PE 头后会剥离 NSIS 的追加数据, 把 101MB 安装器砍到 100KB 空壳
//   - electron-builder 的 winCodeSign 也用同样的 rcedit, 同样会破坏 NSIS
//
// 所以三产物的图标处理分两条路:
//   1. win-unpacked/InsightForge.exe → rcedit 嵌入 PE 图标 (启动后窗口/任务栏看到)
//   2. NSIS / portable                → 不动 PE; 靠 electron-builder.yml 的
//      `nsis.installerIcon` / `nsis.uninstallerIcon` 把 icon.ico 嵌进 MUI 对话框资源
//      (用户安装时看到的"安装对话框图标 / 卸载图标 / 开始菜单快捷方式图标" 都是这里)
//
// 关键: 这步必须在 electron-builder (上一步) **之后** 执行,
//       否则 electron-builder 会用上次嵌入的旧图标覆盖.
//
// 注: build/icon.ico 已在 step 0.2/7 生成; 本步骤只负责生成 rcedit 专用的单尺寸 ICO + 调用 rcedit.
step('6/7 嵌入应用图标 (仅 win-unpacked)');
const { spawnSync } = await import('node:child_process');

function fail(msg) { console.error(`\n❌ ${msg}`); process.exit(1); }

// 6.1 生成单尺寸 256x256 ICO — 专门喂给 rcedit
// ⚠️ rcedit v0.2.0 处理 multi-size PNG-encoded ICO 有 bug: 不会改主图标, 仍保留旧 Electron logo.
// 改用单尺寸 256x256 PNG ICO 后, Windows 资源提取器 (ExtractAssociatedIcon) 能正确拿到新图标.
// electron-builder 仍然吃 multi-size ICO (它的 winCodeSign 会正确处理).
const icoOutSingle = path.join(DESKTOP, 'dist', '.icon-ico', 'icon-256.ico');
const psSingle = path.join(DESKTOP, 'scripts', 'make-single-ico.ps1');
console.log(`  生成单尺寸 256x256 ICO (喂给 rcedit): ${icoOutSingle}`);
const psSingleRun = spawnSync('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psSingle,
   '-PngPath', path.join(DESKTOP, 'build', 'icon.png'),
   '-Output', icoOutSingle,
   '-Size', '256'],
  { stdio: 'inherit' });
if (psSingleRun.status !== 0) fail('make-single-ico.ps1 失败');

// 6.2 rcedit — 自适应探测缓存目录, 不再硬编码 winCodeSign hash
function resolveRcedit() {
  // 项目内 vendored 优先级最高
  const vendored = path.join(DESKTOP, 'resources', 'tools', 'rcedit-x64.exe');
  if (fs.existsSync(vendored)) return vendored;
  // electron-builder 缓存目录: glob 任意版本子目录
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || process.env.HOME || '',
    'electron-builder', 'Cache', 'winCodeSign'
  );
  if (fs.existsSync(cacheRoot)) {
    const found = fs.readdirSync(cacheRoot)
      .map((d) => path.join(cacheRoot, d, 'rcedit-x64.exe'))
      .filter((p) => fs.existsSync(p))
      .sort();
    if (found.length) return found[found.length - 1];
  }
  return null;
}

const rcedit = resolveRcedit();
if (!rcedit) {
  console.warn('  ⚠️ 找不到 rcedit-x64.exe, 跳过 win-unpacked 图标嵌入');
  console.warn('     从 https://github.com/electron/rcedit/releases 下载并放到');
  console.warn('     desktop/resources/tools/rcedit-x64.exe 后重新构建');
} else {
  // 只 rcedit RELEASE/win-unpacked/InsightForge.exe. NSIS / portable 由 electron-builder
  // 通过 nsis.installerIcon/nsis.uninstallerIcon 配置嵌入 MUI 图标 (不动 PE).
  const targets = [path.join(DESKTOP, '..', 'RELEASE', 'win-unpacked', 'InsightForge.exe')]
    .filter((p) => fs.existsSync(p));
  if (targets.length === 0) {
    console.warn('  ⚠️ win-unpacked/InsightForge.exe 不存在, 跳过嵌入步骤');
  } else {
    for (const exePath of targets) {
      console.log(`  嵌入 ${path.basename(exePath)}`);
      const before = fs.statSync(exePath).size;
      const r = spawnSync(rcedit, [exePath, '--set-icon', icoOutSingle], { stdio: 'inherit' });
      if (r.status !== 0) fail(`rcedit 嵌入 ${exePath} 失败`);
      const after = fs.statSync(exePath).size;
      console.log(`    大小: ${before} → ${after} (Δ ${after - before})`);
    }
    console.log(`  ✅ 已嵌入 win-unpacked 图标 (NSIS / portable 跳过, 避免 rcedit 损坏安装器)`);
  }
}

// ---------- 收尾 ----------
step('7/7 收尾');
// 校验安装包内 backend 资源齐全 (signAndEditExecutable:false 可能影响 extraResources)
const unpackedResources = path.join(DESKTOP, '..', 'RELEASE', 'win-unpacked', 'resources');
if (!fs.existsSync(unpackedResources) || !fs.existsSync(path.join(unpackedResources, 'backend'))) {
  console.warn(`  ⚠️ ${unpackedResources}/backend 缺失, 请检查 electron-builder.yml extraResources.filter`);
} else {
  console.log('  ✅ win-unpacked/resources/backend 已就绪');
}

// --dist 模式: 同步发布辅助文件到 RELEASE/  , 引导用户选 portable / NSIS / 刷新图标
if (process.argv.includes('--dist')) {
  const releaseDir = path.join(DESKTOP, '..', 'RELEASE');
  const extraFiles = [
    { src: path.join(DESKTOP, 'release-readme.txt'), name: 'README.txt', msg: '引导选 portable' },
    { src: path.join(DESKTOP, 'scripts', 'refresh-taskbar-icon.ps1'),
      name: 'refresh-taskbar-icon.ps1', msg: '刷新 Windows 任务栏图标' },
  ];
  for (const f of extraFiles) {
    if (fs.existsSync(f.src)) {
      fs.copyFileSync(f.src, path.join(releaseDir, f.name));
      console.log(`  ✅ 已复制 ${path.basename(f.src)} → RELEASE/${f.name} (${f.msg})`);
    } else {
      console.warn(`  ⚠️ 未找到 ${f.src}, 跳过`);
    }
  }
}

console.log('\n✅ 完成');
console.log(`  backend:   ${backendRes}`);
console.log(`  icon.ico:  ${iconIcoPath}`);
if (process.argv.includes('--dist')) {
  console.log(`  安装包:    ${path.join(DESKTOP, '..', 'RELEASE')}`);
}
