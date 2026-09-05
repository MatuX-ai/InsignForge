/**
 * api/admin.ts 单元测试
 *
 * 覆盖:
 *  - GET /admin/sources/health
 *      空快照 → 200 + sources: []
 *      有源 → 200 + state + metrics
 *  - POST /admin/sources/breaker/reset  (v1.7+)
 *      body.source 缺失 → 400
 *      body.source 为空字符串 → 400
 *      未知源(从未调用过)→ 200 + existed=false
 *      已注册源 → 200 + existed=true
 *      logger.info 被调用
 *
 * Mock 策略:
 *  - mock retryMetrics / cache / cacheScheduler / scheduler/index (admin.ts 其他路由依赖)
 *  - 不 mock reliability: 真实测试 resetSource / snapshotSourceHealth 的端到端行为
 *  - mock logger 验证 admin 路由的日志输出
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetAllMetrics = vi.fn(() => []);
const mockResetMetrics = vi.fn();
const mockGetCacheMetrics = vi.fn(() => []);
const mockResetCacheMetrics = vi.fn();
vi.mock('../src/services/llm/retryMetrics.js', () => ({
  getAllMetrics: () => mockGetAllMetrics(),
  resetMetrics: () => mockResetMetrics(),
  getCacheMetrics: () => mockGetCacheMetrics(),
  resetCacheMetrics: () => mockResetCacheMetrics(),
}));

const mockClearExpired = vi.fn(() => 0);
const mockGetCacheStats = vi.fn(() => ({ total: 0, active: 0, expired: 0, bySchema: [] }));
vi.mock('../src/services/llm/cache.js', () => ({
  clearExpired: () => mockClearExpired(),
  getCacheStats: () => mockGetCacheStats(),
}));

const mockGetCacheCleanupSchedulerStatus = vi.fn(() => ({
  running: false,
  intervalMs: 86_400_000,
  firstDelayMs: 60_000,
  lastRunAt: null,
  lastRemoved: null,
  lastDurationMs: null,
  nextRunAt: null,
}));
vi.mock('../src/services/llm/cacheScheduler.js', () => ({
  getCacheCleanupSchedulerStatus: () => mockGetCacheCleanupSchedulerStatus(),
}));

const mockGetSchedulersStatus = vi.fn(() => []);
vi.mock('../src/services/scheduler/index.js', () => ({
  getSchedulersStatus: () => mockGetSchedulersStatus(),
}));

import { adminRouter } from '../src/api/admin.js';
import express from 'express';
import type { AddressInfo } from 'node:net';
import {
  sourceMetrics,
  withReliability,
  resetAllSourceBundles,
  snapshotSourceHealth,
} from '../src/services/search/reliability.js';
import { logger } from '../src/logger.js';

function mkApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
}

async function getJson(
  app: express.Express,
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

beforeEach(() => {
  sourceMetrics.reset();
  resetAllSourceBundles();
  mockGetAllMetrics.mockReturnValue([]);
  mockGetCacheMetrics.mockReturnValue([]);
  mockGetCacheStats.mockReturnValue({ total: 0, active: 0, expired: 0, bySchema: [] });
  mockGetCacheCleanupSchedulerStatus.mockReturnValue({
    running: false,
    intervalMs: 86_400_000,
    firstDelayMs: 60_000,
    lastRunAt: null,
    lastRemoved: null,
    lastDurationMs: null,
    nextRunAt: null,
  });
  mockGetSchedulersStatus.mockReturnValue([]);
  vi.mocked(logger.info).mockClear();
});

describe('GET /admin/sources/health', () => {
  it('空快照 → 200 + sources: []', async () => {
    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/health');
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    const data = body.data as { sources: unknown[]; snapshotAt: string };
    expect(data.sources).toEqual([]);
    expect(typeof data.snapshotAt).toBe('string');
  });

  it('有源(closed) → 200 + state/metrics', async () => {
    // 触发 withReliability 一次成功, 让 bundle + metrics 都出现
    await withReliability({ source: 'hackernews', cacheKey: 'test:hk:1' }, async () => 'ok');
    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/health');
    expect(status).toBe(200);
    const data = body.data as {
      sources: Array<{ source: string; state: string; metrics: { total: number; success: number } }>;
    };
    expect(data.sources).toHaveLength(1);
    const hn = data.sources[0];
    expect(hn?.source).toBe('hackernews');
    expect(hn?.state).toBe('closed');
    expect(hn?.metrics.success).toBe(1);
    expect(hn?.metrics.total).toBe(1);
  });

  it('snapshot 暴露真实 SourceHealthSummary 形状(state + metrics)', async () => {
    // 触发连续失败让 breaker 打开
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    for (let i = 0; i < 5; i += 1) {
      await withReliability({ source: 'reddit' }, failing).catch(() => undefined);
    }
    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/health');
    expect(status).toBe(200);
    const data = body.data as {
      sources: Array<{
        source: string;
        state: string;
        metrics: { failure: number; circuitOpened: number };
      }>;
    };
    const rd = data.sources.find((s) => s.source === 'reddit');
    expect(rd).toBeDefined();
    expect(rd?.state).toBe('open');
    expect(rd?.metrics.failure).toBe(5);
    expect(rd?.metrics.circuitOpened).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /admin/sources/breaker/reset (v1.7+)', () => {
  it('body.source 缺失 → 400', async () => {
    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/breaker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.code).toBe(400);
    expect(String(body.message)).toContain('source 必填');
  });

  it('body.source 为空字符串 → 400', async () => {
    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/breaker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: '   ' }),
    });
    expect(status).toBe(400);
    expect(body.code).toBe(400);
  });

  it('body.source 非字符串(如数字)→ 400', async () => {
    const app = mkApp();
    const { status } = await getJson(app, '/admin/sources/breaker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 123 }),
    });
    expect(status).toBe(400);
  });

  it('未注册的源 → 200 + existed=false', async () => {
    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/breaker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'unknown-source' }),
    });
    expect(status).toBe(200);
    const data = body.data as {
      source: string;
      existed: boolean;
      cacheCleared: boolean;
      snapshotAt: string;
    };
    expect(data.source).toBe('unknown-source');
    expect(data.existed).toBe(false);
    expect(data.cacheCleared).toBe(false);
    expect(typeof data.snapshotAt).toBe('string');
  });

  it('已注册源 → 200 + existed=true + cacheCleared=true', async () => {
    // 先触发一次成功调用,让 openserp bundle 出现
    await withReliability({ source: 'openserp', cacheKey: 'test:os:1' }, async () => 'ok');
    // bundle 创建后快照里应能看到 openserp(closed)
    const before = snapshotSourceHealth().find((s) => s.source === 'openserp');
    expect(before).toBeDefined();

    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/breaker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'openserp' }),
    });
    expect(status).toBe(200);
    const data = body.data as {
      source: string;
      existed: boolean;
      cacheCleared: boolean;
    };
    expect(data.source).toBe('openserp');
    expect(data.existed).toBe(true);
    expect(data.cacheCleared).toBe(true);

    // 路由 handler 内 logger.info('admin: 重置数据源熔断器', ...) 被调用
    const calls = vi.mocked(logger.info).mock.calls;
    const matched = calls.some(
      ([meta, msg]) =>
        (meta as { source?: string } | undefined)?.source === 'openserp' &&
        typeof msg === 'string' &&
        msg.includes('重置数据源熔断器')
    );
    expect(matched).toBe(true);
  });

  it('重置后该源从 bundle 移除,下次 withReliability 创建全新 closed 状态的 bundle', async () => {
    // v1.7+: 设计动机验证。
    // 场景: 启动期内 OpenSerp 连续打 5 次 ECONNREFUSED → breaker 被打开到 open。
    // main.cjs 调 reset 路由后,下次 withReliability 应重建 closed 状态的 breaker
    // (而不是依赖 30s 冷却窗口自动 half_open)。
    const failing = vi.fn(async () => {
      throw new Error('connection refused');
    });
    for (let i = 0; i < 5; i += 1) {
      await withReliability({ source: 'openserp' }, failing).catch(() => undefined);
    }
    // 重置前: snapshot 中 openserp 的 state 应该是 open(5 连败打满阈值)
    const beforeReset = snapshotSourceHealth().find((s) => s.source === 'openserp');
    expect(beforeReset?.state).toBe('open');

    // 调 reset 路由
    const app = mkApp();
    const { status, body } = await getJson(app, '/admin/sources/breaker/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'openserp' }),
    });
    expect(status).toBe(200);
    expect((body.data as { existed: boolean }).existed).toBe(true);

    // 下次 withReliability 应从 closed 重新累积,不携带之前的连续失败计数
    let successAllowed = false;
    await withReliability({ source: 'openserp', cacheKey: 'test:os:after-reset' }, async () => {
      successAllowed = true;
      return 'ok';
    });
    expect(successAllowed).toBe(true);
    const afterReset = snapshotSourceHealth().find((s) => s.source === 'openserp');
    expect(afterReset?.state).toBe('closed');
  });
});
