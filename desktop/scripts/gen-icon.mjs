/**
 * 生成 InsightForge 应用图标 (build/icon.png, 512x512)
 * 纯 Node 实现: 像素绘制 + zlib 压缩手写 PNG 编码, 无第三方依赖
 *
 * 图案: 深蓝渐变背景 + 放大镜(洞察) + 上升趋势线(市场增长)
 * 用法: node scripts/gen-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 512;

// ---------- 颜色工具 ----------
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

const BG_TOP = [15, 23, 42]; // #0F172A
const BG_BOTTOM = [30, 41, 59]; // #1E293B
const C1 = [34, 211, 238]; // cyan #22D3EE
const C2 = [139, 92, 246]; // violet #8B5CF6

// ---------- 形状函数(归一化坐标 0~1, 中心 0.5,0.5) ----------
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** 线段距离(用于趋势线笔画) */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 平滑覆盖值: d>0 完全覆盖, d<0 完全透明, 边界抗锯齿 */
function cov(d) {
  return Math.max(0, Math.min(1, 0.5 - d * SIZE * 0.5));
}

function drawPixel(px, py) {
  // 背景: 垂直渐变
  let color = lerpColor(BG_TOP, BG_BOTTOM, py);
  let alpha = 255;

  // 圆角矩形裁切(图标圆角)
  const radius = 0.16;
  const rx = Math.min(Math.max(px, radius), 1 - radius);
  const ry = Math.min(Math.max(py, radius), 1 - radius);
  const cornerDist = Math.hypot(px - rx, py - ry) - radius;
  alpha = Math.round(cov(cornerDist) * 255);

  // 放大镜: 环形镜片(中心 0.5, 0.46, 半径 0.2, 环厚 0.055)
  const lensD = sdCircle(px, py, 0.5, 0.46, 0.2);
  const holeD = sdCircle(px, py, 0.5, 0.46, 0.2 - 0.055);
  const ring = Math.max(lensD, -holeD);
  // 镜片玻璃: 内部渐变
  const glassD = sdCircle(px, py, 0.5, 0.46, 0.2 - 0.055);

  // 把手(从镜片右下到图标右下)
  const handleD = distToSegment(px, py, 0.63, 0.59, 0.78, 0.74) - 0.045;

  // 趋势线(镜片内上升折线)
  const seg1 = distToSegment(px, py, 0.4, 0.52, 0.5, 0.42);
  const seg2 = distToSegment(px, py, 0.5, 0.42, 0.56, 0.5);
  const seg3 = distToSegment(px, py, 0.56, 0.5, 0.62, 0.38);
  const lineD = Math.min(seg1, seg2, seg3) - 0.022;

  const ringCov = cov(ring);
  const glassCov = cov(glassD);
  const handleCov = cov(handleD);
  const lineCov = cov(lineD);

  // 镜片玻璃: 半透明深色 + 内部反光
  if (glassCov > 0) {
    const glassColor = lerpColor([2, 6, 23], [51, 65, 85], py);
    color = lerpColor(color, glassColor, glassCov * 0.85);
  }

  // 渐变环 + 把手
  const accent = lerpColor(C1, C2, px * 0.6 + py * 0.4);
  if (ringCov > 0) {
    color = lerpColor(color, accent, ringCov);
  }
  if (handleCov > 0) {
    color = lerpColor(color, accent, handleCov);
  }

  // 趋势线: 亮青色
  if (lineCov > 0) {
    color = lerpColor(color, [165, 243, 252], lineCov * 0.9);
  }

  return [Math.round(color[0]), Math.round(color[1]), Math.round(color[2]), alpha];
}

// ---------- PNG 编码 ----------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 渲染(2x2 超采样抗锯齿) ----------
console.log('渲染图标 512x512 ...');
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const [pr, pg, pb, pa] = drawPixel((x + ox) / SIZE, (y + oy) / SIZE);
      r += pr * pa;
      g += pg * pa;
      b += pb * pa;
      a += pa;
    }
    const idx = (y * SIZE + x) * 4;
    if (a > 0) {
      rgba[idx] = Math.round(r / a);
      rgba[idx + 1] = Math.round(g / a);
      rgba[idx + 2] = Math.round(b / a);
    }
    rgba[idx + 3] = Math.round(a / 4);
  }
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
fs.writeFileSync(outPath, encodePng(SIZE, SIZE, rgba));
console.log(`✅ 图标已生成: ${outPath}`);
