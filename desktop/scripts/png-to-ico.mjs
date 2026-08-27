/**
 * 把 PNG 包装成 ICO 格式(单图标, PNG 嵌入)
 *
 * 现代 Windows 接受 ICO 内的 PNG 字节(BMP 也行,但 PNG 体积小且支持透明)。
 * electron-builder 24.x 的 rcedit 能正确读取这种 ICO。
 *
 * 用法: node desktop/scripts/png-to-ico.mjs <input.png> <output.ico>
 */
import fs from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('用法: node png-to-ico.mjs <input.png> <output.ico>');
  process.exit(1);
}

const png = fs.readFileSync(input);
// 校验 PNG 签名
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!png.subarray(0, 8).equals(sig)) {
  console.error('不是合法的 PNG');
  process.exit(1);
}
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);

// ICO header: 6 bytes
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = ICO
header.writeUInt16LE(1, 4); // count = 1

// ICO entry: 16 bytes
const entry = Buffer.alloc(16);
entry[0] = w >= 256 ? 0 : w; // 0 表示 256
entry[1] = h >= 256 ? 0 : h;
entry[2] = 0; // 颜色数 (0 表示无调色板)
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // 颜色平面
entry.writeUInt16LE(32, 6); // 位深
entry.writeUInt32LE(png.length, 8); // 图像大小
entry.writeUInt32LE(22, 12); // 偏移 (header 6 + entry 16 = 22)

fs.writeFileSync(output, Buffer.concat([header, entry, png]));
console.log(`✅ ${input} (${w}x${h}) → ${output} (${22 + png.length} bytes)`);
