/**
 * 手写 ZIP STORE 编码器 (无压缩模式)
 *
 * 为什么不引入 archiver / jszip 等依赖:
 *   - InsightForge 是个人版 MVP,依赖最小化原则
 *   - Markdown 文件本身压缩率低 (~3%),STORE 模式差距不大
 *   - STORE 模式编码简单稳定,没有压缩算法依赖
 *
 * ZIP 格式参考: PKWARE APPNOTE.TXT
 *   - Local File Header  (30 字节 + 文件名)
 *   - File Data          (原文,无压缩)
 *   - Central Directory  (46 字节 + 文件名) × N
 *   - End of Central Dir (22 字节 + 注释)
 *
 * 所有多字节字段使用 little-endian,字符串使用 UTF-8 编码
 */
import { Buffer } from 'node:buffer';

/** 单个待打包的文件 */
export interface ZipEntry {
  /** ZIP 内的路径,例如 "docs/00-INDEX.md" */
  path: string;
  /** UTF-8 文本内容 */
  content: string;
}

/**
 * 编码 DOS 日期时间 (用于 Local File Header / Central Directory)
 * 时间: 时 5 bit | 分 6 bit | 秒/2 5 bit (共 16 bit)
 * 日期: 年+1980 7 bit | 月 4 bit | 日 5 bit (共 16 bit)
 */
function dosDateTime(d: Date): { date: number; time: number } {
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date =
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { date, time };
}

/**
 * CRC32 校验 - 使用标准多项式 0xEDB88320
 * 仅用于 ZIP 校验和,数据量小 (KB 级) 时性能足够
 */
const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 把多个文本文件打包成 ZIP (STORE 模式) Buffer
 * 文件名使用 UTF-8,标记 General Purpose Bit Flag bit 11
 *
 * 安全检查:
 *   - 拒绝包含 '..' 的路径 (Zip Slip)
 *   - 拒绝绝对路径 (以 / 或 \\ 开头)
 *   - 拒绝空路径
 *   - 文件名长度限制为 240 字节 (避免主流 OS 解压失败)
 */
export function createZipBuffer(entries: ZipEntry[], now: Date = new Date()): Buffer {
  // ---------- 安全断言 (fail-fast) ----------
  for (const entry of entries) {
    if (!entry.path) {
      throw new Error('zip: 文件路径不能为空');
    }
    if (Buffer.byteLength(entry.path, 'utf8') > 240) {
      throw new Error(`zip: 文件名过长 (${entry.path.length} 字节): ${entry.path}`);
    }
    // Zip Slip: 不允许跨级路径
    if (entry.path.includes('..')) {
      throw new Error(`zip: 不允许包含 '..' 的路径: ${entry.path}`);
    }
    // 绝对路径:POSIX (/) 或 Windows (\\) 都不允许
    if (entry.path.startsWith('/') || entry.path.startsWith('\\')) {
      throw new Error(`zip: 不允许绝对路径: ${entry.path}`);
    }
  }

  const { date, time } = dosDateTime(now);

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const dataBuf = Buffer.from(entry.content, 'utf8');
    const crc = crc32(dataBuf);
    const size = dataBuf.length;

    // ---------- Local File Header (30 + nameLen) ----------
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(20, 4); // version needed to extract (2.0)
    lfh.writeUInt16LE(0x0800, 6); // general purpose: UTF-8 filename
    lfh.writeUInt16LE(0, 8); // compression method: 0 = STORE
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(crc, 14); // CRC-32
    lfh.writeUInt32LE(size, 18); // compressed size (== uncompressed in STORE)
    lfh.writeUInt32LE(size, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // file name length
    lfh.writeUInt16LE(0, 28); // extra field length

    localParts.push(lfh, nameBuf, dataBuf);

    // ---------- Central Directory Header (46 + nameLen) ----------
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // signature
    cdh.writeUInt16LE(20, 4); // version made by (2.0)
    cdh.writeUInt16LE(20, 6); // version needed to extract
    cdh.writeUInt16LE(0x0800, 8); // general purpose: UTF-8
    cdh.writeUInt16LE(0, 10); // compression method
    cdh.writeUInt16LE(time, 12);
    cdh.writeUInt16LE(date, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28); // file name length
    cdh.writeUInt16LE(0, 30); // extra field length
    cdh.writeUInt16LE(0, 32); // file comment length
    cdh.writeUInt16LE(0, 34); // disk number start
    cdh.writeUInt16LE(0, 36); // internal file attributes
    cdh.writeUInt32LE(0, 38); // external file attributes (普通文件)
    cdh.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + size;
  }

  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const p of centralParts) centralDirSize += p.length;

  // ---------- End of Central Directory Record (22) ----------
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // size of central dir
  eocd.writeUInt32LE(centralDirStart, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([
    ...localParts,
    ...centralParts,
    eocd,
  ]);
}