/**
 * utils/zip.ts 单元测试
 *
 * 覆盖:
 *   1. ZIP 头部签名正确 (Local Header 0x04034b50, EOCD 0x06054b50)
 *   2. CRC32 计算与 zlib 的 crc32 对齐 (已知向量)
 *   3. 安全断言: Zip Slip / 绝对路径 / 空路径 / 超长文件名
 *   4. UTF-8 文件名支持 (General Purpose Bit Flag bit 11)
 *   5. EOCD entries count 与输入一致
 */
import { describe, it, expect } from 'vitest';
import { createZipBuffer } from '../src/utils/zip.js';
import { Buffer } from 'node:buffer';
import zlib from 'node:zlib';

describe('createZipBuffer - 编码正确性', () => {
  it('写入合法的 Local Header 签名 0x04034b50', () => {
    const buf = createZipBuffer([{ path: 'a.txt', content: 'hi' }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('写入合法的 End of Central Directory 签名 0x06054b50', () => {
    const buf = createZipBuffer([{ path: 'a.txt', content: 'hi' }]);
    const eocdSig = buf.readUInt32LE(buf.length - 22);
    expect(eocdSig).toBe(0x06054b50);
  });

  it('EOCD 的 entries on this disk 与 total entries 一致,且等于 entries.length', () => {
    const buf = createZipBuffer([
      { path: 'a.txt', content: '1' },
      { path: 'b.txt', content: '22' },
      { path: 'c.txt', content: '333' },
    ]);
    // EOCD 偏移: signature(4) + disk(2) + diskWithCD(2) + entriesOnDisk(2) + totalEntries(2)
    const eocdStart = buf.length - 22;
    const entriesOnDisk = buf.readUInt16LE(eocdStart + 8);
    const totalEntries = buf.readUInt16LE(eocdStart + 10);
    expect(entriesOnDisk).toBe(3);
    expect(totalEntries).toBe(3);
  });

  it('CRCC32 与 zlib.crc32 一致 (空文件)', () => {
    // 空字符串的 CRC32 已知为 0
    const buf = createZipBuffer([{ path: 'empty.txt', content: '' }]);
    // LFH CRC32 偏移 14
    expect(buf.readUInt32LE(14)).toBe(0);
    expect(zlib.crc32(Buffer.from(''))).toBe(0);
  });

  it('CRC32 与 zlib.crc32 一致 ("hello world")', () => {
    const content = 'hello world';
    const buf = createZipBuffer([{ path: 'hello.txt', content }]);
    const ourCrc = buf.readUInt32LE(14);
    const refCrc = zlib.crc32(Buffer.from(content));
    expect(ourCrc).toBe(refCrc);
  });

  it('CRC32 与 zlib.crc32 一致 (中文内容)', () => {
    const content = '你好,世界\n🚀 emoji 测试';
    const buf = createZipBuffer([{ path: 'cn.txt', content }]);
    const ourCrc = buf.readUInt32LE(14);
    const refCrc = zlib.crc32(Buffer.from(content, 'utf8'));
    expect(ourCrc).toBe(refCrc);
  });

  it('多个文件:各自 CRC32 都正确', () => {
    const entries = [
      { path: 'a.txt', content: 'first' },
      { path: 'b.txt', content: 'second content' },
      { path: '中文.md', content: '# 标题\n正文内容' },
    ];
    const buf = createZipBuffer(entries);
    // 顺序遍历,逐个 CRC 校验
    let offset = 0;
    for (const e of entries) {
      const nameBuf = Buffer.from(e.path, 'utf8');
      // LFH: signature(4) + version(2) + flags(2) + method(2) + time(2) + date(2) = 16
      // CRC32 在偏移 14 (signature后10字节)
      const lfhCrc = buf.readUInt32LE(offset + 14);
      const refCrc = zlib.crc32(Buffer.from(e.content, 'utf8'));
      expect(lfhCrc).toBe(refCrc);
      // Central Directory 也会包含同样 CRC,我们只校验 LFH
      offset += 30 + nameBuf.length + Buffer.byteLength(e.content, 'utf8');
    }
  });

  it('UTF-8 flag 在 General Purpose Bit Flag (bit 11) 置位', () => {
    const buf = createZipBuffer([{ path: '中文.txt', content: 'x' }]);
    const flags = buf.readUInt16LE(6);
    expect(flags & 0x0800).toBe(0x0800);
  });

  it('空 entries 数组也能生成合法 ZIP (只有 EOCD)', () => {
    const buf = createZipBuffer([]);
    expect(buf.length).toBe(22);
    expect(buf.readUInt32LE(0)).toBe(0x06054b50);
    expect(buf.readUInt16LE(8)).toBe(0);
  });

  it('DOS 时间字段被设置 (非零)', () => {
    const buf = createZipBuffer([{ path: 'a.txt', content: 'x' }]);
    const time = buf.readUInt16LE(10);
    const date = buf.readUInt16LE(12);
    // 当前时间应非零;若某天零点是特殊情况,允许 date 为 0
    expect(time + date).toBeGreaterThan(0);
  });
});

describe('createZipBuffer - 安全断言', () => {
  it('空路径 → 抛错', () => {
    expect(() => createZipBuffer([{ path: '', content: 'x' }])).toThrow(/路径不能为空/);
  });

  it("包含 '..' → 抛错 (Zip Slip)", () => {
    expect(() =>
      createZipBuffer([{ path: '../etc/passwd', content: 'x' }])
    ).toThrow(/不允许包含 '\.\.'/);
    expect(() =>
      createZipBuffer([{ path: 'sub/../../../escape.txt', content: 'x' }])
    ).toThrow(/不允许包含 '\.\.'/);
  });

  it('POSIX 绝对路径 → 抛错', () => {
    expect(() => createZipBuffer([{ path: '/etc/passwd', content: 'x' }])).toThrow(
      /不允许绝对路径/
    );
  });

  it('Windows 绝对路径 → 抛错', () => {
    expect(() =>
      createZipBuffer([{ path: '\\Windows\\System32\\evil.exe', content: 'x' }])
    ).toThrow(/不允许绝对路径/);
  });

  it('文件名超 240 字节 → 抛错', () => {
    const longPath = 'a'.repeat(241) + '.md';
    expect(() => createZipBuffer([{ path: longPath, content: 'x' }])).toThrow(
      /文件名过长/
    );
  });

  it('正好 240 字节文件名 → 通过 (边界值)', () => {
    const okPath = 'a'.repeat(236) + '.md'; // 240 bytes
    expect(() => createZipBuffer([{ path: okPath, content: 'x' }])).not.toThrow();
  });

  it('混合合法+非法 entries 时,首个非法即抛错', () => {
    expect(() =>
      createZipBuffer([
        { path: 'good.txt', content: 'ok' },
        { path: '../bad.txt', content: 'evil' },
      ])
    ).toThrow(/不允许包含 '\.\.'/);
  });

  it('合法子目录路径 → 通过', () => {
    expect(() =>
      createZipBuffer([{ path: 'docs/sub/file.md', content: 'x' }])
    ).not.toThrow();
  });

  it('文件名含中文 → 通过', () => {
    expect(() =>
      createZipBuffer([{ path: '产品需求文档.md', content: '正文' }])
    ).not.toThrow();
  });

  it('文件名含 emoji → 通过 (UTF-8 字节数 > 字符数但 < 240)', () => {
    expect(() =>
      createZipBuffer([{ path: '📘-guide.md', content: 'x' }])
    ).not.toThrow();
  });
});