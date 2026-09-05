/**
 * 验证 InsightForge.exe 嵌入的图标是否是新图标（立方体+箭头）。
 *
 * 不依赖像素完全一致（PNG 编码/bicubic 缩放会引入微小差异），
 * 而是统计两张图标像素颜色直方图的相似度。
 *
 * 用法: node desktop/scripts/verify-exe-icon.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------- 参数解析与路径解析 ----------
const argTarget = process.argv.find((a) => a.startsWith('--target='));
const target = argTarget ? argTarget.split('=')[1] : 'win-unpacked';

function latestOf(dir, re) {
  if (!fs.existsSync(dir)) return null;
  const found = fs.readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ p: path.resolve(dir, f), m: fs.statSync(path.resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return found.length ? found[0].p : null;
}

const RE_NSIS     = /^InsightForge-\d+\.\d+\.\d+-x64\.exe$/;
const RE_PORTABLE = /^InsightForge-\d+\.\d+\.\d+-portable-x64\.exe$/;

const exePath = (() => {
  if (target === 'nsis')     return latestOf('../RELEASE', RE_NSIS);
  if (target === 'portable') return latestOf('../RELEASE', RE_PORTABLE);
  return path.resolve('../RELEASE/win-unpacked/InsightForge.exe');
})();
if (!exePath || !fs.existsSync(exePath)) {
  console.error(`❌ 找不到 EXE (target=${target}): ${exePath ?? '(路径解析失败)'}`);
  console.error('   请先跑 npm run build 或 npm run dist 生成产物');
  process.exit(1);
}

const refIcon = path.resolve('build/icon.png');
if (!fs.existsSync(refIcon)) {
  console.error(`❌ 找不到参考图标: ${refIcon}`);
  process.exit(1);
}

const tmpDir = os.tmpdir();
const exeIconPng    = path.join(tmpDir, `exe-icon-${Date.now()}.png`);
const exeIconScaled = path.join(tmpDir, `exe-icon-scaled-${Date.now()}.png`);
const refIconScaled = path.join(tmpDir, `ref-icon-scaled-${Date.now()}.png`);

// 1. 从 EXE 提取关联图标 (32x32) → 保存 PNG
const psExtract = [
  'Add-Type -AssemblyName System.Drawing',
  `$exe = '${exePath.replace(/'/g, "''")}'`,
  `$out = '${exeIconPng.replace(/'/g, "''")}'`,
  '$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)',
  '$bmp = $icon.ToBitmap()',
  '$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)',
  '$bmp.Dispose(); $icon.Dispose()',
].join('\n');
const psFile = path.join(tmpDir, `verify-${Date.now()}.ps1`);
fs.writeFileSync(psFile, psExtract, 'utf-8');
const r1 = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], {
  encoding: 'utf-8',
});
fs.unlinkSync(psFile);
if (r1.status !== 0 || !fs.existsSync(exeIconPng)) {
  console.error('❌ 提取 exe 图标失败');
  console.error(r1.stderr || r1.stdout);
  process.exit(1);
}

// 2. 把两张图都缩放到 256x256 用于像素直方图比较
function scaleTo(src, dst) {
  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    `$img = [System.Drawing.Image]::FromFile('${src.replace(/'/g, "''")}')`,
    `$bmp = New-Object System.Drawing.Bitmap 256, 256`,
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$g.DrawImage($img, 0, 0, 256, 256)',
    `$bmp.Save('${dst.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$g.Dispose(); $bmp.Dispose(); $img.Dispose()',
  ].join('\n');
  const tf = path.join(tmpDir, `scale-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(tf, ps, 'utf-8');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tf], {
    encoding: 'utf-8',
  });
  fs.unlinkSync(tf);
  return r.status;
}
scaleTo(exeIconPng, exeIconScaled);
scaleTo(refIcon, refIconScaled);

// 3. 计算两张 256x256 图的颜色直方图 (16 个 bin 量化到 RGB(4,4,4))
function histogram(filePath) {
  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    `$bmp = [System.Drawing.Bitmap]::FromFile('${filePath.replace(/'/g, "''")}')`,
    '$hist = @{}',
    'for ($y=0; $y -lt 256; $y+=2) { for ($x=0; $x -lt 256; $x+=2) {',
    '  $c = $bmp.GetPixel($x, $y)',
    '  $key = ([int]($c.R / 64)) * 16 + ([int]($c.G / 64)) * 4 + ([int]($c.B / 64))',
    '  if ($hist.ContainsKey($key)) { $hist[$key]++ } else { $hist[$key] = 1 }',
    '}}',
    '$bmp.Dispose()',
    '$sorted = $hist.Keys | Sort-Object',
    'foreach ($k in $sorted) { Write-Host ("{0}:{1}" -f $k, $hist[$k]) }',
  ].join('\n');
  const tf = path.join(tmpDir, `hist-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(tf, ps, 'utf-8');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tf], {
    encoding: 'utf-8',
  });
  fs.unlinkSync(tf);
  const hist = {};
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.trim().match(/^(\d+):(\d+)$/);
    if (m) hist[m[1]] = parseInt(m[2], 10);
  }
  return hist;
}

const exeHist = histogram(exeIconScaled);
const refHist = histogram(refIconScaled);

// 计算余弦相似度
const allKeys = new Set([...Object.keys(exeHist), ...Object.keys(refHist)]);
let dot = 0, magExe = 0, magRef = 0;
for (const k of allKeys) {
  const a = exeHist[k] || 0;
  const b = refHist[k] || 0;
  dot += a * b;
  magExe += a * a;
  magRef += b * b;
}
const cosine = magExe && magRef ? dot / Math.sqrt(magExe * magRef) : 0;

// 清理临时文件
fs.unlinkSync(exeIconPng);
fs.unlinkSync(exeIconScaled);
fs.unlinkSync(refIconScaled);

console.log(`📦 exe (target=${target}): ${exePath}`);
console.log(`   ${fs.statSync(exePath).size} bytes, 修改于 ${fs.statSync(exePath).mtime.toISOString()}`);
console.log(`🖼️  提取的 EXE 图标 (32x32)`);
console.log(`🖼️  参考图标:        ${refIcon}`);
console.log(`\n--- 颜色直方图相似度 (256-bin RGB cube) ---`);
console.log(`  exe 直方图 bins: ${Object.keys(exeHist).length}, 总像素 ${Object.values(exeHist).reduce((a, b) => a + b, 0)}`);
console.log(`  ref 直方图 bins: ${Object.keys(refHist).length}, 总像素 ${Object.values(refHist).reduce((a, b) => a + b, 0)}`);
console.log(`  余弦相似度: ${cosine.toFixed(4)}`);

let verdict;
if (cosine >= 0.95) verdict = '✅ 几乎一致：exe 已嵌入新图标 (立方体+箭头)';
else if (cosine >= 0.80) verdict = '⚠️  部分一致：可能是新图标但缩放/编码有差异';
else verdict = '❌ 差异较大：exe 图标可能不是新的';

console.log(`\n${verdict}`);
process.exit(cosine >= 0.80 ? 0 : 1);