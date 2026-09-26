/**
 * utils/archive.ts 单元测试 - v1.8 P2-C: 移除项目归档目录
 *
 * 覆盖:
 *   1. 正常流程: 存在的目录被 rmSync 删除,函数返回 true
 *   2. 幂等: 目录不存在时返回 false(而不是抛错)
 *   3. 路径防御: ../ /  /  \\ / 80+ 长度 都被拒绝
 *   4. 安全: 不删除根目录本身(只清掉指定子目录)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 先 mock logger(config 在 logger 之前被解析,logger 还会引用 config,
// 因此 logger mock 放在 config mock 之前更稳)
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 用 vi.hoisted 在 mock 工厂中拿到 tmpRoot,避免闭包问题
const state = vi.hoisted(() => ({ tmpRoot: '' }));

vi.mock('../src/config.js', () => ({
  config: {
    get HISTORY_DOC_DIR() {
      return state.tmpRoot;
    },
  },
}));

import { removeProjectArchive } from '../src/utils/archive.js';

describe('removeProjectArchive - 防御 + 行为', () => {
  let subDir: string;

  beforeEach(() => {
    state.tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'if-archive-test-'));
    subDir = path.join(state.tmpRoot, '项目ABC');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'a.md'), 'hello');
    fs.writeFileSync(path.join(subDir, 'b.zip'), 'fake-zip-bytes');
  });

  afterEach(() => {
    try {
      fs.rmSync(state.tmpRoot, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
    state.tmpRoot = '';
  });

  it('正常: 存在的归档目录被删除, 返回 true', () => {
    expect(fs.existsSync(subDir)).toBe(true);
    const ok = removeProjectArchive('项目ABC');
    expect(ok).toBe(true);
    expect(fs.existsSync(subDir)).toBe(false);
  });

  it('幂等: 目录不存在时返回 false, 不抛错', () => {
    // 先删一次
    fs.rmSync(subDir, { recursive: true, force: true });
    const ok = removeProjectArchive('项目ABC');
    expect(ok).toBe(false);
  });

  it('防御: 空字符串 → false', () => {
    expect(removeProjectArchive('')).toBe(false);
    expect(fs.existsSync(subDir)).toBe(true);
  });

  it('防御: 含 ".." → false', () => {
    expect(removeProjectArchive('../escape')).toBe(false);
    expect(fs.existsSync(subDir)).toBe(true);
  });

  it('防御: 含 "/" → false', () => {
    expect(removeProjectArchive('sub/dir')).toBe(false);
    expect(fs.existsSync(subDir)).toBe(true);
  });

  it('防御: 含 "\\" → false', () => {
    expect(removeProjectArchive('sub\\dir')).toBe(false);
    expect(fs.existsSync(subDir)).toBe(true);
  });

  it('防御: 长度 > 80 → false', () => {
    const longKey = 'a'.repeat(81);
    expect(removeProjectArchive(longKey)).toBe(false);
    expect(fs.existsSync(subDir)).toBe(true);
  });

  it('安全: 不删除根目录本身(只清掉指定子目录)', () => {
    removeProjectArchive('项目ABC');
    expect(fs.existsSync(state.tmpRoot)).toBe(true);
    // 根目录下应已无项目目录
    const entries = fs.readdirSync(state.tmpRoot);
    expect(entries.length).toBe(0);
  });
});