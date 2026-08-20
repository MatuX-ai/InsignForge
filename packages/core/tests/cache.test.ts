/**
 * 单元测试 —— LRU 缓存(SimpleLRUCache / reportCacheKey)
 *
 * 覆盖:
 * - set / get 基础语义
 * - TTL 过期
 * - LRU 淘汰(maxEntries)
 * - reportCacheKey 稳定性(同输入同输出)
 * - clear / delete
 */
import { describe, it, expect, vi } from 'vitest';
import { SimpleLRUCache, reportCacheKey } from '../src/cache.js';
import type { MarketReport } from '../src/types.js';

const fakeReport: MarketReport = {
  summary: 'test summary long enough',
  market_heat: {
    search_volume: 100,
    discussion_count: 10,
    trend: 'stable',
    heat_score: 50,
  },
  competitors: [],
  pain_points: [],
  market_size: 'tiny',
  risks: [],
  opportunities: [],
  sources: [],
  generated_at: new Date().toISOString(),
  depth: 'standard',
  keywords: ['a', 'b'],
};

describe('SimpleLRUCache', () => {
  it('set / get 基础读写', () => {
    const c = new SimpleLRUCache<string>(10, 60_000);
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
  });

  it('未命中返回 undefined', () => {
    const c = new SimpleLRUCache<string>(10, 60_000);
    expect(c.get('nope')).toBeUndefined();
  });

  it('size 反映条目数', () => {
    const c = new SimpleLRUCache<string>(10, 60_000);
    expect(c.size).toBe(0);
    c.set('a', '1');
    c.set('b', '2');
    expect(c.size).toBe(2);
  });

  it('delete 移除条目并返回 boolean', () => {
    const c = new SimpleLRUCache<string>(10, 60_000);
    c.set('a', '1');
    expect(c.delete('a')).toBe(true);
    expect(c.delete('a')).toBe(false);
    expect(c.size).toBe(0);
  });

  it('clear 清空全部', () => {
    const c = new SimpleLRUCache<string>(10, 60_000);
    c.set('a', '1');
    c.set('b', '2');
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get('a')).toBeUndefined();
  });

  it('TTL 过期后 get 返回 undefined 并自动删除', () => {
    vi.useFakeTimers();
    try {
      const c = new SimpleLRUCache<string>(10, 1000);
      c.set('k', 'v');
      expect(c.get('k')).toBe('v');
      vi.advanceTimersByTime(1001);
      expect(c.get('k')).toBeUndefined();
      expect(c.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('LRU 淘汰:超过 maxEntries 时淘汰最早插入', () => {
    const c = new SimpleLRUCache<string>(3, 60_000);
    c.set('a', '1');
    c.set('b', '2');
    c.set('c', '3');
    // 再插入会淘汰最早('a')
    c.set('d', '4');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('3');
    expect(c.get('d')).toBe('4');
  });

  it('LRU 续命:get 后再次 set 不淘汰刚访问的条目', () => {
    const c = new SimpleLRUCache<string>(3, 60_000);
    c.set('a', '1');
    c.set('b', '2');
    c.set('c', '3');
    // 访问 'a',使其移到队尾
    c.get('a');
    // 再插入 -> 淘汰最早的 'b'
    c.set('d', '4');
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBeUndefined();
  });

  it('支持复杂值类型(MarketReport)', () => {
    const c = new SimpleLRUCache<MarketReport>(10, 60_000);
    c.set('r', fakeReport);
    expect(c.get('r')).toEqual(fakeReport);
  });
});

describe('reportCacheKey', () => {
  it('同 idea + depth 同日输出相同 key', () => {
    const k1 = reportCacheKey('AI todo app', 'standard');
    const k2 = reportCacheKey('AI todo app', 'standard');
    expect(k1).toBe(k2);
  });

  it('不同 depth 输出不同 key', () => {
    expect(reportCacheKey('idea', 'quick')).not.toBe(reportCacheKey('idea', 'deep'));
  });

  it('空白折叠为单个空格', () => {
    const k1 = reportCacheKey('hello   world', 'standard');
    const k2 = reportCacheKey('hello world', 'standard');
    expect(k1).toBe(k2);
  });

  it('大小写不敏感', () => {
    const k1 = reportCacheKey('AI Todo', 'standard');
    const k2 = reportCacheKey('ai todo', 'standard');
    expect(k1).toBe(k2);
  });

  it('key 格式:report:{depth}:{YYYY-MM-DD}:{hash}', () => {
    const k = reportCacheKey('any', 'quick');
    expect(k).toMatch(/^report:quick:\d{4}-\d{2}-\d{2}:[a-z0-9-]+$/);
  });
});