/**
 * 从 "InsightForge 市场报告Logo设计.png" 提取上半部分的"立方体+箭头"图标,
 * 重新渲染为 1024x1024 PNG, 作为桌面应用图标 (desktop/build/icon.png)。
 *
 * 设计稿原图: 1557x1450
 *   - 立方体+箭头: y ≈ 80 ~ 1080
 *   - "InsightForge" 文字: y ≈ 1200 ~ 1450
 *
 * 用法: node desktop/scripts/regen-icon.mjs
 * 依赖: puppeteer-core + 系统 Edge(无需 sharp/jimp)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_PNG = path.join(ROOT, 'InsightForge 市场报告Logo设计.png');
const OUT_DIR = path.join(__dirname, '..', 'build');
const OUT_PATH = path.join(OUT_DIR, 'icon.png');
const SIZE = 1024;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const EDGE_EXE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));

if (!fs.existsSync(SOURCE_PNG)) {
  console.error(`❌ 源设计稿不存在: ${SOURCE_PNG}`);
  process.exit(1);
}
if (!EDGE_EXE) {
  console.error('❌ 未找到 Microsoft Edge');
  process.exit(1);
}

// 渲染规则: 用 SVG viewBox 精确裁剪原图的"立方体+箭头"区域
//   原图 1557x1450
//   立方体+箭头区域(目测, 留出一点边距): x ≈ 420~1200 (宽 780), y ≈ 60~1100 (高 1040)
//   viewBox 用 420 60 780 1040 截取该正方形区域, 然后渲染到 1024x1024
const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; }
  svg { display: block; }
</style>
</head><body>
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="420 60 780 1040" preserveAspectRatio="xMidYMid slice">
    <image xlink:href="/source.png" x="0" y="0" width="1557" height="1450" />
  </svg>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/source.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    fs.createReadStream(SOURCE_PNG).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
console.log(`🌐 临时服务: ${url}`);

const tmpShot = path.join(OUT_DIR, '__icon-tmp.png');
fs.mkdirSync(OUT_DIR, { recursive: true });

await new Promise((resolve, reject) => {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--window-size=${SIZE},${SIZE}`,
    `--screenshot=${tmpShot}`,
    url,
  ];
  console.log(`> Edge --headless 截图 ${SIZE}x${SIZE}`);
  const p = spawn(EDGE_EXE, args, { stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Edge 退出 code=${code}`))));
});

server.close();

// ---------- PNG 解码 (支持 filter 0/1/2/3/4) ----------
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('Not a PNG');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const W = ihdr.readUInt32BE(0);
  const H = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (bitDepth !== 8) throw new Error(`仅支持 8-bit, 实际 ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持 colorType=${colorType}`);
  const bpp = channels; // 8-bit 时 bpp == channels
  const stride = W * bpp;
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);

  const pixels = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) {
    const filter = raw[y * (stride + 1)];
    const srcStart = y * (stride + 1) + 1;
    const dstStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[srcStart + x];
      const left = x >= bpp ? pixels[dstStart + x - bpp] : 0;
      const up = y > 0 ? pixels[dstStart - stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? pixels[dstStart - stride + x - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = cur; break;
        case 1: val = (cur + left) & 0xff; break;
        case 2: val = (cur + up) & 0xff; break;
        case 3: val = (cur + ((left + up) >> 1)) & 0xff; break;
        case 4: val = (cur + paethPredictor(left, up, upLeft)) & 0xff; break;
        default: throw new Error(`未知 filter ${filter}`);
      }
      pixels[dstStart + x] = val;
    }
  }
  return { W, H, channels, pixels };
}

// ---------- PNG 编码 (filter=0, RGBA) ----------
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function makeChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(W, H, rgbaPixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA 8-bit
  const stride = W * 4;
  const raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0;
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', idat), makeChunk('IEND', Buffer.alloc(0))]);
}

// ---------- 处理 ----------
console.log('�️ 解码 PNG 并把背景替换为透明...');
const pngBuf = fs.readFileSync(tmpShot);
const { W, H, channels, pixels } = decodePng(pngBuf);
console.log(`  源 PNG: ${W}x${H}, channels=${channels}`);

// 转 RGBA + 背景透明化
const rgba = Buffer.alloc(W * H * 4);
let transparentCount = 0;
for (let i = 0, j = 0; i < pixels.length; i += channels, j += 4) {
  const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
  let a = channels === 4 ? pixels[i + 3] : 255;
  // 背景阈值: 米白色 #FAF8F2 附近 (R,G > 235 且差异 < 20)
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max > 235 && (max - min) < 20) {
    a = 0;
    transparentCount++;
  }
  rgba[j] = r; rgba[j + 1] = g; rgba[j + 2] = b; rgba[j + 3] = a;
}
console.log(`  透明像素: ${transparentCount} / ${W * H} (${((transparentCount / (W * H)) * 100).toFixed(1)}%)`);

const newPng = encodePng(W, H, rgba);
fs.writeFileSync(OUT_PATH, newPng);
fs.unlinkSync(tmpShot);
console.log(`✅ 应用图标已更新: ${OUT_PATH} (${W}x${H}, ${newPng.length} bytes)`);
