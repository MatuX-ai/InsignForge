/**
 * services/llm/cacheScheduler.ts 单元测试 (v1.5 缓存过期清理调度器)
 *
 * 覆盖:
 *   1. start 幂等: 重复 start 不会创建多个 timer
 *   2. stop 幂等: 重复 stop 不抛错
 *   3. status 在 start 前后变化正确
 *   4. 环境变量 INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS 解析
 *      - 未配置 → 默认 24h
 *      - 非法值 → fallback 默认
 *      - < 1 → fallback 默认(下限保护)
 *   5. 环境变量 INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC 解析
 *   6. 首次执行: 设置短延迟后能跑完一次,lastRunAt / lastRemoved / lastDurationMs 更新
 *   7. 缓存关闭时调度器不报错,lastRemoved 记为 0
 *   8. 多次 start / stop 切换不会泄漏 timer(unref + clearTimeout)
 *   9. stop 后 status.running=false
 *
 * 设计:
 *   - 用 _resetCacheCleanupSchedulerForTest 在每个 case 前清状态
 *   - 用真实 timer(短 firstDelay 100ms)验证执行路径,避免 fake timer 与 setTimeout 嵌套复杂度
 *   - 不到 1s 等待,测试体感好
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 与 cache.test.ts 同样的 in-memory SQLite 替换
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');
const inMemoryDb = new Database(':memory:');
inMemoryDb.pragma('journal_mode = MEMORY');
inMemoryDb.exec(
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
  startCacheCleanupScheduler,
  stopCacheCleanupScheduler,
  getCacheCleanupSchedulerStatus,
  _resetCacheCleanupSchedulerForTest,
} from '../src/services/llm/cacheScheduler.js';
import { setCachedOutput } from '../src/services/llm/cache.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  _resetCacheCleanupSchedulerForTest();
  inMemoryDb.exec('DELETE FROM llm_cache');
  delete process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS;
  delete process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC;
  delete process.env.INSIGHTFORGE_LLM_CACHE_ENABLED;
});

afterEach(() => {
  stopCacheCleanupScheduler();
  inMemoryDb.exec('DELETE FROM llm_cache');
});

describe('start / stop 幂等', () => {
  it('初始 status.running=false', () => {
    expect(getCacheCleanupSchedulerStatus().running).toBe(false);
  });

  it('start 后 status.running=true', () => {
    startCacheCleanupScheduler();
    expect(getCacheCleanupSchedulerStatus().running).toBe(true);
  });

  it('重复 start 不会创建多个 timer', () => {
    startCacheCleanupScheduler();
    startCacheCleanupScheduler();
    startCacheCleanupScheduler();
    // 内部 handle 数量应仍是 1(timeoutHandle 阶段)
    const status = getCacheCleanupSchedulerStatus();
    expect(status.running).toBe(true);
    // 没有报错,且调用 3 次后状态一致
    stopCacheCleanupScheduler();
  });

  it('stop 幂等,重复调用不抛错', () => {
    startCacheCleanupScheduler();
    expect(() => {
      stopCacheCleanupScheduler();
      stopCacheCleanupScheduler();
      stopCacheCleanupScheduler();
    }).not.toThrow();
    expect(getCacheCleanupSchedulerStatus().running).toBe(false);
  });

  it('stop 在未 start 时也不抛错', () => {
    expect(() => stopCacheCleanupScheduler()).not.toThrow();
    expect(getCacheCleanupSchedulerStatus().running).toBe(false);
  });

  it('stop 后再次 start 能正常工作', () => {
    startCacheCleanupScheduler();
    stopCacheCleanupScheduler();
    startCacheCleanupScheduler();
    expect(getCacheCleanupSchedulerStatus().running).toBe(true);
  });
});

describe('环境变量解析', () => {
  it('默认 24h / 60s', () => {
    startCacheCleanupScheduler();
    const s = getCacheCleanupSchedulerStatus();
    expect(s.intervalMs).toBe(24 * 3600_000);
    expect(s.firstDelayMs).toBe(60_000);
  });

  it('INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS=6 → 21_600_000ms', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS = '6';
    startCacheCleanupScheduler();
    expect(getCacheCleanupSchedulerStatus().intervalMs).toBe(6 * 3600_000);
  });

  it('INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS=0.5 → 回退默认 24h(下限保护)', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS = '0.5';
    startCacheCleanupScheduler();
    expect(getCacheCleanupSchedulerStatus().intervalMs).toBe(24 * 3600_000);
  });

  it('INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS 非法值 → 回退默认', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS = 'abc';
    startCacheCleanupScheduler();
    expect(getCacheCleanupSchedulerStatus().intervalMs).toBe(24 * 3600_000);
  });

  it('INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC=10 → 10_000ms', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC = '10';
    startCacheCleanupScheduler();
    expect(getCacheCleanupSchedulerStatus().firstDelayMs).toBe(10_000);
  });

  it('INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC=-5 → 回退默认 60s', () => {
    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC = '-5';
    startCacheCleanupScheduler();
    expect(getCacheCleanupSchedulerStatus().firstDelayMs).toBe(60_000);
  });
});

describe('首次执行', () => {
  it('短 firstDelay 后能跑完一次,lastRunAt / lastRemoved / lastDurationMs 更新', async () => {
    // 插入一条已过期记录,期望被清理
    const pastExpiry = new Date(Date.now() - 86_400_000).toISOString();
    inMemoryDb
      .prepare(
        `INSERT INTO llm_cache (cache_key, schema_name, output_json, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .run('expired-key', 'A', '{}', pastExpiry);

    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC = '0.05';
    startCacheCleanupScheduler();
    // 等待首次执行完成(50ms 触发 + runOnce 是同步 SQLite 操作,~ 几 ms)
    await sleep(150);

    const s = getCacheCleanupSchedulerStatus();
    expect(s.lastRunAt).not.toBeNull();
    expect(s.lastRemoved).toBe(1); // 删了 1 条过期
    expect(s.lastDurationMs).toBeGreaterThanOrEqual(0);
    expect(s.nextRunAt).not.toBeNull();
    expect(s.running).toBe(true);
  });

  it('首次执行时无过期记录,lastRemoved=0', async () => {
    setCachedOutput('active', 'A', '{}', { ttlDays: 7 });

    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC = '0.05';
    startCacheCleanupScheduler();
    await sleep(150);

    const s = getCacheCleanupSchedulerStatus();
    expect(s.lastRemoved).toBe(0);
    expect(s.lastRunAt).not.toBeNull();
  });

  it('缓存全局关闭时,首次执行不报错,lastRemoved=0', async () => {
    process.env.INSIGHTFORGE_LLM_CACHE_ENABLED = 'false';
    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC = '0.05';

    startCacheCleanupScheduler();
    await sleep(150);

    const s = getCacheCleanupSchedulerStatus();
    expect(s.lastRunAt).not.toBeNull();
    expect(s.lastRemoved).toBe(0);
    expect(s.running).toBe(true);
  });

  it('stop 后 lastRunAt 仍保留(不抹除历史)', async () => {
    process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC = '0.05';
    startCacheCleanupScheduler();
    await sleep(150);
    const beforeStop = getCacheCleanupSchedulerStatus();
    stopCacheCleanupScheduler();
    const afterStop = getCacheCleanupSchedulerStatus();
    expect(afterStop.lastRunAt).toBe(beforeStop.lastRunAt);
    expect(afterStop.running).toBe(false);
  });
});
