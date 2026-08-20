/**
 * 简单 LRU + TTL 缓存(用于市场报告结果)
 *
 * key 由 (idea + depth + day) 哈希得到,缓存命中直接返回 MarketReport。
 * cacheEnabled=false 时跳过缓存,允许框架按内存压力清理。
 */
import type { MarketReport, ResearchDepth } from './types.js';

interface CacheEntry<V> {
  value: V;
  expireAt: number;
  hits: number;
}

export class SimpleLRUCache<V> {
  private store = new Map<string, CacheEntry<V>>();

  constructor(
    private readonly maxEntries = 128,
    private readonly ttlMs = 24 * 60 * 60 * 1000 // 默认 1 天
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expireAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    entry.hits++;
    // LRU 续命
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries) {
      // 删除最早插入(FIFO tail)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expireAt: Date.now() + this.ttlMs,
      hits: 0,
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** 基于 idea+depth+day 生成稳定缓存 key */
export function reportCacheKey(idea: string, depth: ResearchDepth): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const normalized = idea.trim().toLowerCase().replace(/\s+/g, ' ');
  // 简单 hash;避免引入 crypto 模块在大字符串场景的额外开销
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = (h * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `report:${depth}:${day}:${h.toString(36)}`;
}

export type ReportCache = SimpleLRUCache<MarketReport>;
