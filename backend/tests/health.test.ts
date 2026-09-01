/**
 * api/health.ts 单元测试
 *
 * 覆盖:
 *   - GET /health/sources
 *       空快照 → healthy / 200 / 空 sources
 *       有源 closed + 高成功率 → healthy
 *       有源 half_open 或低成功率 → degraded (200)
 *       有源 open → unhealthy (503)
 *   - GET /health/sources/:name
 *       已知源 → 返回其 metrics + state
 *       未知源 → 返回 closed + 全零 metrics(非 404,便于前端诊断)
 *   - GET /health/system (v1.6)
 *       DB ok + LLM 已配置 + Cache 启用 + Scheduler 运行 → healthy
 *       LLM 未配置 → degraded
 *       Cache 关闭 → degraded
 *       DB 抛错 → unhealthy / 503
 *
 * Mock 策略:
 *   - 直接 mock reliability 模块的 snapshotSourceHealth,避免依赖真实 metrics
 *   - 不需要 DB / LLM,纯路由层断言
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');
const inMemoryDb = new Database(':memory:');
inMemoryDb.pragma('journal_mode = MEMORY');

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockSnapshot = vi.fn();
vi.mock('../src/services/search/reliability.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/search/reliability.js')>(
    '../src/services/search/reliability.js'
  );
  return {
    ...actual,
    snapshotSourceHealth: (...args: unknown[]) => mockSnapshot(...args),
  };
});

// 默认 mock:DB 可用 + LLM 已配置 + Cache 启用 + Scheduler 跑
// 这里使用 vi.fn() 而非箭头函数,以便逐测试通过 vi.mocked() 覆盖返回值
vi.mock('../src/db/index.js', () => ({
  getDb: vi.fn(() => inMemoryDb),
}));

vi.mock('../src/config.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return {
    ...actual,
    getLlmApiKey: vi.fn(() => 'mock-api-key'),
    config: {
      ...actual.config,
      LLM_PROVIDER: 'deepseek',
      LLM_MODEL: 'deepseek-chat',
    },
  };
});

vi.mock('../src/services/llm/cache.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/services/llm/cache.js')>(
      '../src/services/llm/cache.js'
    );
  return {
    ...actual,
    isCacheEnabled: vi.fn(() => true),
    getCacheStats: vi.fn(() => ({ total: 100, active: 80, expired: 20, bySchema: [] })),
  };
});

vi.mock('../src/services/llm/cacheScheduler.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/services/llm/cacheScheduler.js')>(
      '../src/services/llm/cacheScheduler.js'
    );
  return {
    ...actual,
    getCacheCleanupSchedulerStatus: vi.fn(() => ({
      running: true,
      intervalMs: 86_400_000,
      firstDelayMs: 60_000,
      lastRunAt: new Date().toISOString(),
      lastRemoved: 0,
      lastDurationMs: 5,
      nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
    })),
  };
});

// 导入路由 & 受控依赖
import { healthRouter } from '../src/api/health.js';
import express from 'express';
import type { AddressInfo } from 'node:net';

import type { SourceHealthSummary } from '../src/services/search/reliability.js';
import { isCacheEnabled, getCacheStats } from '../src/services/llm/cache.js';
import { getCacheCleanupSchedulerStatus } from '../src/services/llm/cacheScheduler.js';
import { getDb } from '../src/db/index.js';
import { getLlmApiKey } from '../src/config.js';

function mkApp() {
  const app = express();
  app.use('/health', healthRouter);
  return app;
}

function summary(
  source: string,
  state: 'closed' | 'open' | 'half_open',
  successRate: number,
  failure = 0
): SourceHealthSummary {
  return {
    source,
    state,
    metrics: {
      source,
      success: Math.round(successRate * 10),
      failure,
      total: Math.round(successRate * 10) + failure,
      successRate,
      avgLatencyMs: 100,
      failureByKind: failure > 0 ? { network: failure } : {},
      cacheHits: 0,
      circuitOpened: state === 'open' ? 1 : 0,
    },
  };
}

async function getJson(app: express.Express, path: string) {
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

beforeEach(() => {
  mockSnapshot.mockReset();
});

describe('GET /health/sources - 状态聚合', () => {
  it('空快照 → healthy / 200', async () => {
    mockSnapshot.mockReturnValueOnce([]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources');
    expect(status).toBe(200);
    expect((body.data as { status: string }).status).toBe('healthy');
    expect((body.data as { sources: unknown[] }).sources).toEqual([]);
    expect((body.data as { summary: { total: number; avgSuccessRate: number } }).summary).toEqual({
      total: 0,
      open: 0,
      halfOpen: 0,
      closed: 0,
      avgSuccessRate: 0,
    });
  });

  it('全部 closed 且高成功率 → healthy / 200', async () => {
    mockSnapshot.mockReturnValueOnce([
      summary('hackernews', 'closed', 0.95),
      summary('reddit', 'closed', 0.9),
    ]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources');
    expect(status).toBe(200);
    const data = body.data as {
      status: string;
      summary: { avgSuccessRate: number; closed: number };
    };
    expect(data.status).toBe('healthy');
    expect(data.summary.closed).toBe(2);
    expect(data.summary.avgSuccessRate).toBeCloseTo(0.925);
  });

  it('有 half_open → degraded / 200', async () => {
    mockSnapshot.mockReturnValueOnce([
      summary('hackernews', 'closed', 0.95),
      summary('reddit', 'half_open', 0.6, 4),
    ]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources');
    expect(status).toBe(200);
    expect((body.data as { status: string }).status).toBe('degraded');
  });

  it('有 open → unhealthy / 503', async () => {
    mockSnapshot.mockReturnValueOnce([
      summary('hackernews', 'closed', 0.95),
      summary('reddit', 'open', 0.3, 7),
    ]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources');
    expect(status).toBe(503);
    const data = body.data as {
      status: string;
      summary: { open: number };
    };
    expect(data.status).toBe('unhealthy');
    expect(data.summary.open).toBe(1);
  });

  it('平均成功率 < 50% → unhealthy / 503', async () => {
    mockSnapshot.mockReturnValueOnce([
      summary('hn', 'closed', 0.4, 6),
      summary('rd', 'closed', 0.3, 7),
    ]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources');
    expect(status).toBe(503);
    expect((body.data as { status: string }).status).toBe('unhealthy');
  });

  it('平均成功率 50%~80% → degraded / 200', async () => {
    mockSnapshot.mockReturnValueOnce([
      summary('hn', 'closed', 0.7, 3),
      summary('rd', 'closed', 0.7, 3),
    ]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources');
    expect(status).toBe(200);
    expect((body.data as { status: string }).status).toBe('degraded');
  });
});

describe('GET /health/sources/:name', () => {
  it('已知源 → 返回该源 metrics + state', async () => {
    mockSnapshot.mockReturnValueOnce([summary('hackernews', 'half_open', 0.6, 4)]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources/hackernews');
    expect(status).toBe(200);
    const data = body.data as { source: { source: string; state: string } };
    expect(data.source.source).toBe('hackernews');
    expect(data.source.state).toBe('half_open');
  });

  it('未知源 → 200 + closed + 全零 metrics(便于前端统一处理)', async () => {
    mockSnapshot.mockReturnValueOnce([summary('hackernews', 'closed', 1, 0)]);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/sources/unknown-source');
    expect(status).toBe(200);
    const data = body.data as { source: { source: string; state: string; metrics: { total: number; success: number } } };
    expect(data.source.source).toBe('unknown-source');
    expect(data.source.state).toBe('closed');
    expect(data.source.metrics.total).toBe(0);
    expect(data.source.metrics.success).toBe(0);
  });
});

// ----- v1.6 GET /health/system -----

interface SystemData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  db: { ok: boolean; latencyMs: number; error?: string };
  llm: { provider: string; model: string; configured: boolean };
  cache: { enabled: boolean; total: number; active: number; expired: number };
  scheduler: { running: boolean; intervalMs: number; nextRunAt: string | null };
  issues: string[];
}

beforeEach(() => {
  // 每个 case 重置 mock 默认值,避免上一个 case 的 mockReturnValueOnce 残留
  vi.mocked(isCacheEnabled).mockReturnValue(true);
  vi.mocked(getCacheStats).mockReturnValue({
    total: 100,
    active: 80,
    expired: 20,
    bySchema: [],
  });
  vi.mocked(getCacheCleanupSchedulerStatus).mockReturnValue({
    running: true,
    intervalMs: 86_400_000,
    firstDelayMs: 60_000,
    lastRunAt: new Date().toISOString(),
    lastRemoved: 0,
    lastDurationMs: 5,
    nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  vi.mocked(getLlmApiKey).mockReturnValue('mock-api-key');
  vi.mocked(getDb).mockReturnValue(inMemoryDb);
});

describe('GET /health/system - 状态聚合(v1.6)', () => {
  it('DB OK + LLM 已配置 + Cache 启用 + Scheduler 跑 → healthy / 200', async () => {
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/system');
    expect(status).toBe(200);
    const data = body.data as SystemData;
    expect(data.status).toBe('healthy');
    expect(data.db.ok).toBe(true);
    expect(data.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(data.llm.configured).toBe(true);
    expect(data.cache.enabled).toBe(true);
    expect(data.scheduler.running).toBe(true);
    expect(data.issues).toEqual([]);
  });

  it('LLM 未配置 → degraded / 200 + issues 提示', async () => {
    vi.mocked(getLlmApiKey).mockReturnValue('');
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/system');
    expect(status).toBe(200);
    const data = body.data as SystemData;
    expect(data.status).toBe('degraded');
    expect(data.llm.configured).toBe(false);
    expect(data.issues.some((s) => s.startsWith('llm:'))).toBe(true);
  });

  it('Cache 全局关闭 → degraded / 200 + issues 提示', async () => {
    vi.mocked(isCacheEnabled).mockReturnValue(false);
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/system');
    expect(status).toBe(200);
    const data = body.data as SystemData;
    expect(data.status).toBe('degraded');
    expect(data.cache.enabled).toBe(false);
    expect(data.issues.some((s) => s.startsWith('cache:'))).toBe(true);
  });

  it('Scheduler 未运行 → degraded + issues 提示', async () => {
    vi.mocked(getCacheCleanupSchedulerStatus).mockReturnValue({
      running: false,
      intervalMs: 86_400_000,
      firstDelayMs: 60_000,
      lastRunAt: null,
      lastRemoved: null,
      lastDurationMs: null,
      nextRunAt: null,
    });
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/system');
    expect(status).toBe(200);
    const data = body.data as SystemData;
    expect(data.status).toBe('degraded');
    expect(data.issues.some((s) => s.startsWith('scheduler:'))).toBe(true);
  });

  it('Cache 总量 > 50_000 → degraded + issues 提示', async () => {
    vi.mocked(getCacheStats).mockReturnValue({
      total: 60_000,
      active: 50_000,
      expired: 10_000,
      bySchema: [],
    });
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/system');
    expect(status).toBe(200);
    const data = body.data as SystemData;
    expect(data.status).toBe('degraded');
    expect(data.cache.total).toBe(60_000);
    expect(data.issues.some((s) => s.includes('偏高'))).toBe(true);
  });

  it('DB 抛错 → unhealthy / 503 + issues 提示', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('database is locked');
    });
    const app = mkApp();
    const { status, body } = await getJson(app, '/health/system');
    expect(status).toBe(503);
    const data = body.data as SystemData;
    expect(data.status).toBe('unhealthy');
    expect(data.db.ok).toBe(false);
    expect(data.db.error).toContain('database is locked');
    expect(data.issues.some((s) => s.startsWith('db:'))).toBe(true);
  });

  it('响应包含 uptime / checkedAt 字段', async () => {
    const app = mkApp();
    const { body } = await getJson(app, '/health/system');
    const data = body.data as SystemData;
    expect(typeof data.uptime).toBe('number');
    expect(typeof data.scheduler.intervalMs).toBe('number');
  });
});
