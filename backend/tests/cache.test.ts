/**
 * services/llm/cache.ts 单元测试 (v1.5 持久化缓存)
 *
 * 覆盖:
 *   1. makeCacheKey 稳定性(同输入 → 同 key)
 *   2. makeCacheKey 对 options 差异敏感(temperature / maxTokens)
 *   3. getCachedOutput 未命中返回 null
 *   4. setCachedOutput → getCachedOutput 命中返回原始 content
 *   5. 命中累计 hit_count(原子 UPDATE)
 *   6. setCachedOutput 幂等(同 key 重复写入不抛错)
 *   7. TTL 过期:getCachedOutput 返回 null;clearExpired 清理
 *   8. getCacheStats 返回 total / active / expired / bySchema
 *   9. INSIGHTFORGE_LLM_CACHE_ENABLED=false 时全 no-op
 *  10. INSIGHTFORGE_LLM_CACHE_TTL_DAYS 自定义
 *
 * 设计:
 *   - 用 vi.mock 替换 db/index.js,提供一个 :memory: SQLite 实例;
 *     这样既验证 SQL 正确性,又避免污染真实数据文件
 *   - 每个测试 beforeEach 清空 llm_cache 表,保证状态隔离
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 用真实 :memory: better-sqlite3 实例替换 db,验证 SQL 路径
const inMemoryDb = (() => {
  // 动态 require 避免 ESM/CJS 解析问题
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(
    `CREATE TABLE IF NOT EXISTS llm_cache (
      cache_key TEXT PRIMARY KEY,
      schema_name TEXT NOT NULL,
      output_json TEXT NOT NULL,
      input_size INTEGER NOT NULL DEFAULT 0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_cache_schema ON llm_cache(schema_name);
    CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_cache(expires_at);`
  );
  return db;
})();

vi.mock('../src/db/index.js', () => ({
  getDb: () => inMemoryDb,
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  makeCacheKey,
  getCachedOutput,
  setCachedOutput,
  clearExpired,
  getCacheStats,
  getDefaultTtlDays,
} from '../src/services/llm/cache.js';

beforeEach(() => {
  inMemoryDb.exec('DELETE FROM llm_cache');
  delete process.env.INSIGHTFORGE_LLM_CACHE_ENABLED;
  delete process.env.INSIGHTFORGE_LLM_CACHE_TTL_DAYS;
});

afterEach(() => {
  inMemoryDb.exec('DELETE FROM llm_cache');
  delete process.env.INSIGHTFORGE_LLM_CACHE_ENABLED;
  delete process.env.INSIGHTFORGE_LLM_CACHE_TTL_DAYS;
});

describe('makeCacheKey - 哈希稳定性', () => {
  it('同输入产生同 key', () => {
    const a = makeCacheKey('test', 'sys', 'usr', { temperature: 0.4, maxTokens: 1000 });
    const b = makeCacheKey('test', 'sys', 'usr', { temperature: 0.4, maxTokens: 1000 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('schemaName 不同 → key 不同', () => {
    expect(makeCacheKey('A', 'sys', 'usr', {})).not.toBe(makeCacheKey('B', 'sys', 'usr', {}));
  });

  it('system 不同 → key 不同', () => {
    expect(makeCacheKey('A', 'sys1', 'usr', {})).not.toBe(makeCacheKey('A', 'sys2', 'usr', {}));
  });

  it('user 不同 → key 不同', () => {
    expect(makeCacheKey('A', 'sys', 'usr1', {})).not.toBe(makeCacheKey('A', 'sys', 'usr2', {}));
  });

  it('temperature 不同 → key 不同', () => {
    expect(makeCacheKey('A', 'sys', 'usr', { temperature: 0.1 })).not.toBe(
      makeCacheKey('A', 'sys', 'usr', { temperature: 0.9 })
    );
  });

  it('maxTokens 不同 → key 不同', () => {
    expect(makeCacheKey('A', 'sys', 'usr', { maxTokens: 500 })).not.toBe(
      makeCacheKey('A', 'sys', 'usr', { maxTokens: 4096 })
    );
  });
});

describe('getCachedOutput - 未命中', () => {
  it('空表返回 null', () => {
    const key = makeCacheKey('s', 'sys', 'usr', {});
    expect(getCachedOutput(key)).toBeNull();
  });

  it('随机 key 返回 null', () => {
    expect(getCachedOutput('nonexistent-key-12345')).toBeNull();
  });
});

describe('setCachedOutput + getCachedOutput - 命中', () => {
  it('写入后能读出原始 content(字符串)', () => {
    const key = makeCacheKey('keyword-extraction', 'sys', 'usr', { temperature: 0.5 });
    setCachedOutput(key, 'keyword-extraction', '{"keywords":["a"]}');
    expect(getCachedOutput(key)).toBe('{"keywords":["a"]}');
  });

  it('写入后能读出原始 content(含中文)', () => {
    const key = makeCacheKey('market-report', 'sys', '中文字符', { temperature: 0.4 });
    setCachedOutput(key, 'market-report', '{"summary":"中文"}');
    expect(getCachedOutput(key)).toBe('{"summary":"中文"}');
  });

  it('命中累加 hit_count(每次 +1)', () => {
    const key = makeCacheKey('rerank', 'sys', 'usr', {});
    setCachedOutput(key, 'rerank', '{}');
    getCachedOutput(key);
    getCachedOutput(key);
    getCachedOutput(key);
    const row = inMemoryDb.prepare('SELECT hit_count FROM llm_cache WHERE cache_key = ?').get(key) as
      | { hit_count: number }
      | undefined;
    expect(row?.hit_count).toBe(3);
  });

  it('不同 schemaName 互相独立', () => {
    const k1 = makeCacheKey('A', 'sys', 'usr', {});
    const k2 = makeCacheKey('B', 'sys', 'usr', {});
    setCachedOutput(k1, 'A', '{"x":1}');
    setCachedOutput(k2, 'B', '{"x":2}');
    expect(getCachedOutput(k1)).toBe('{"x":1}');
    expect(getCachedOutput(k2)).toBe('{"x":2}');
  });

  it('同 key 重复写入幂等(不抛错,保留首次)', () => {
    const key = makeCacheKey('A', 'sys', 'usr', {});
    setCachedOutput(key, 'A', '{"first":true}');
    setCachedOutput(key, 'A', '{"second":true}');
    expect(getCachedOutput(key)).toBe('{"first":true}');
  });

  it('空 schemaName / 空 output 拒绝写入', () => {
    const key = makeCacheKey('A', 'sys', 'usr', {});
    setCachedOutput(key, '   ', 'data');
    setCachedOutput(key, 'A', '');
    const count = (inMemoryDb.prepare('SELECT COUNT(*) as c FROM llm_cache').get() as { c: number }).c;
    expect(count).toBe(0);
  });
});

describe('TTL 过期处理', () => {
  it('未过期记录正常返回', () => {
    const key = makeCacheKey('A', 'sys', 'usr', {});
    // TTL 7 天后过期
    setCachedOutput(key, 'A', '{}', { ttlDays: 7 });
    expect(getCachedOutput(key)).toBe('{}');
  });

  it('已过期记录返回 null', () => {
    const key = makeCacheKey('A', 'sys', 'usr', {});
    // 写入时把 expires_at 设为 1 天前
    const pastExpiry = new Date(Date.now() - 86_400_000).toISOString();
    inMemoryDb
      .prepare(
        `INSERT INTO llm_cache (cache_key, schema_name, output_json, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(key, 'A', '{}', pastExpiry);
    expect(getCachedOutput(key)).toBeNull();
  });

  it('clearExpired 仅删除过期记录,保留活跃记录', () => {
    const activeKey = makeCacheKey('A', 'sys', 'usr-1', {});
    const expiredKey = makeCacheKey('A', 'sys', 'usr-2', {});
    setCachedOutput(activeKey, 'A', '{"active":true}', { ttlDays: 7 });
    const pastExpiry = new Date(Date.now() - 86_400_000).toISOString();
    inMemoryDb
      .prepare(
        `INSERT INTO llm_cache (cache_key, schema_name, output_json, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(expiredKey, 'A', '{"expired":true}', pastExpiry);

    const removed = clearExpired();
    expect(removed).toBe(1);
    expect(getCachedOutput(activeKey)).toBe('{"active":true}');
    expect(getCachedOutput(expiredKey)).toBeNull();
  });
});

describe('getCacheStats - 统计聚合', () => {
  it('空表返回 total=0 / active=0 / expired=0', () => {
    const stats = getCacheStats();
    expect(stats.total).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.expired).toBe(0);
    expect(stats.bySchema).toEqual([]);
  });

  it('正确返回按 schema 维度统计', () => {
    setCachedOutput(makeCacheKey('keyword-extraction', 's', 'u1', {}), 'keyword-extraction', '{}');
    setCachedOutput(makeCacheKey('keyword-extraction', 's', 'u2', {}), 'keyword-extraction', '{}');
    setCachedOutput(makeCacheKey('market-report', 's', 'u1', {}), 'market-report', '{}');

    const stats = getCacheStats();
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(3);
    expect(stats.expired).toBe(0);
    const ke = stats.bySchema.find((s) => s.schema === 'keyword-extraction');
    const mr = stats.bySchema.find((s) => s.schema === 'market-report');
    expect(ke?.count).toBe(2);
    expect(mr?.count).toBe(1);
  });

  it('totalHits 累加 hit_count', () => {
    const key = makeCacheKey('A', 's', 'u', {});
    setCachedOutput(key, 'A', '{}');
    getCachedOutput(key);
    getCachedOutput(key);

    const stats = getCacheStats();
    const row = stats.bySchema.find((s) => s.schema === 'A');
    expect(row?.totalHits).toBe(2);
  });
});

describe('环境变量开关', () => {
  it('INSIGHTFORGE_LLM_CACHE_ENABLED=false → 全 no-op', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_ENABLED = 'false';
    const key = makeCacheKey('A', 's', 'u', {});
    setCachedOutput(key, 'A', '{}');
    expect(getCachedOutput(key)).toBeNull();
    const stats = getCacheStats();
    expect(stats.total).toBe(0);
  });

  it('INSIGHTFORGE_LLM_CACHE_ENABLED=true 显式开启', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_ENABLED = 'true';
    const key = makeCacheKey('A', 's', 'u', {});
    setCachedOutput(key, 'A', '{}');
    expect(getCachedOutput(key)).toBe('{}');
  });

  it('INSIGHTFORGE_LLM_CACHE_TTL_DAYS 自定义', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_TTL_DAYS = '30';
    expect(getDefaultTtlDays()).toBe(30);
  });

  it('INSIGHTFORGE_LLM_CACHE_TTL_DAYS 非法值 → fallback 默认 7', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_TTL_DAYS = 'abc';
    expect(getDefaultTtlDays()).toBe(7);
    process.env.INSIGHTFORGE_LLM_CACHE_TTL_DAYS = '0';
    expect(getDefaultTtlDays()).toBe(7);
    process.env.INSIGHTFORGE_LLM_CACHE_TTL_DAYS = '-5';
    expect(getDefaultTtlDays()).toBe(7);
  });
});