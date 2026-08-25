/**
 * InsightForge 桌面版 - 快速资源组装脚本
 * 
 * 只更新 dist 文件（已修复的 v139 better-sqlite3 保留）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(__dirname, 'resources');

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`  ✅ ${path.basename(src)} → ${path.basename(dest)}`);
}

// 1. 更新后端 dist
console.log('\n=== 1. 更新 backend dist ===');
copyDir(path.join(ROOT, 'backend', 'dist'), path.join(RESOURCES, 'backend', 'dist'));

// 2. 更新前端 dist
console.log('\n=== 2. 更新 frontend dist ===');
copyDir(path.join(ROOT, 'frontend', 'dist'), path.join(RESOURCES, 'frontend-dist'));

// 3. 验证 better-sqlite3
console.log('\n=== 3. 验证 better-sqlite3 ABI ===');
const nodeFile = path.join(RESOURCES, 'backend', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (fs.existsSync(nodeFile)) {
  const buf = fs.readFileSync(nodeFile);
  const str = buf.toString('latin1');
  const abis = ['v139', 'v137', 'v130', 'v127'];
  for (const abi of abis) {
    if (str.includes(abi)) {
      console.log(`  better-sqlite3 ABI: ${abi} ${abi === 'v139' ? '✅ Electron 33 兼容' : '⚠️ 注意: ' + abi}`);
      break;
    }
  }
} else {
  console.log('  ⚠️ .node 文件不存在!');
}

// 4. 检查 electron-builder 版本和 dist 状态
console.log('\n=== 4. 检查 dist 目录 ===');
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  const items = fs.readdirSync(distDir).filter(f => f.endsWith('.exe'));
  items.forEach(f => console.log('  ', f));
} else {
  console.log('  dist 目录不存在');
}

// 5. 检查 win-unpacked 目录
console.log('\n=== 5. 检查 win-unpacked 目录 ===');
const unpackedDir = path.join(__dirname, 'dist', 'win-unpacked');
if (fs.existsSync(unpackedDir)) {
  const resourcesDir = path.join(unpackedDir, 'resources');
  if (fs.existsSync(resourcesDir)) {
    const resItems = fs.readdirSync(resourcesDir);
    console.log('  resources/:', resItems.join(', '));
  }
  
  // 检查 app.asar 是否存在
  const appAsar = path.join(unpackedDir, 'resources', 'app.asar');
  console.log('  app.asar:', fs.existsSync(appAsar) ? '存在' : '不存在');
} else {
  console.log('  win-unpacked 不存在,需要重新 electron-builder');
}

console.log('\n✅ 资源更新完成');
console.log('\n下一步:');
console.log('  重新打包: cd desktop && npm run dist');
console.log('  或仅更新 unpacked: cd desktop && npm run pack');
