/**
 * 直接调用 rcedit-x64.exe 把 icon.ico 嵌入 InsightForge.exe。
 *
 * 优势: 不依赖 electron-builder 的 app-builder 包装层、winCodeSign 缓存解压、签名证书等。
 * 只调用 rcedit.exe --set-icon 一次即可。
 *
 * 用法: node desktop/scripts/patch-exe-icon.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ICON_ICO = path.join(ROOT, 'dist', '.icon-ico', 'icon.ico');
const EXE_PATH = path.join(ROOT, 'dist', 'win-unpacked', 'InsightForge.exe');

// electron-builder 缓存在 %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\583233367\
const RCEDIT = path.join(
  process.env.LOCALAPPDATA || process.env.HOME,
  'electron-builder', 'Cache', 'winCodeSign', '583233367', 'rcedit-x64.exe'
);

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1); }

if (!fs.existsSync(RCEDIT))     fail(`找不到 rcedit-x64.exe: ${RCEDIT}\n   请先运行 desktop/scripts/fetch-wincodesign.mjs 并解压`);
if (!fs.existsSync(ICON_ICO))   fail(`找不到 icon.ico: ${ICON_ICO}\n   请先运行 desktop/scripts/png-to-ico.mjs`);
if (!fs.existsSync(EXE_PATH))   fail(`找不到 InsightForge.exe: ${EXE_PATH}\n   请先 npm run pack 或 npm run dist`);

const beforeSize = fs.statSync(EXE_PATH).size;
const beforeMtime = fs.statSync(EXE_PATH).mtimeMs;
console.log(`📝 嵌入图标: ${ICON_ICO}`);
console.log(`📦 目标 exe: ${EXE_PATH} (${beforeSize} bytes)`);

// rcedit 用法: rcedit <exe> --set-icon <icon.ico>
const r = spawnSync(RCEDIT, [EXE_PATH, '--set-icon', ICON_ICO], {
  stdio: 'inherit',
});
if (r.status !== 0) {
  console.error(`❌ rcedit 退出 ${r.status}`);
  process.exit(r.status ?? 1);
}

const afterSize = fs.statSync(EXE_PATH).size;
const afterMtime = fs.statSync(EXE_PATH).mtimeMs;
console.log(`\n✅ 完成`);
console.log(`   大小:  ${beforeSize} → ${afterSize} (Δ ${afterSize - beforeSize})`);
console.log(`   时间:  ${new Date(beforeMtime).toISOString()} → ${new Date(afterMtime).toISOString()}`);
