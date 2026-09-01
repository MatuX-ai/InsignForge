/**
 * search/reliability.ts 单元测试
 *
 * 覆盖:
 *   - SourceError 分类(retryable 与否)
 *   - fetchWithRetry:
 *       2xx 一次成功
 *       429 / 5xx 重试到上限后抛
 *       4xx 不重试直接抛
 *       网络错重试
 *       sleep 可注入,避免真实等待
 *   - TtlCache: 命中 / 过期 / 容量上限淘汰
 *   - CircuitBreaker: closed → open → half_open → closed / open 转换
 *   - sourceMetrics: 成功/失败/缓存/熔断计数,只读快照
 *   - withReliability: 熔断短路 / 缓存命中 / 成功写缓存 / 失败写指标
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  SourceError,
  fetchWithRetry,
  createTtlCache,
  createCircuitBreaker,
  sourceMetrics,
  withReliability,
  resetAllSourceBundles,
  hashKey,
  sourceErrorKindToCode,
} from '../src/services/search/reliability.js';

beforeEach(() => {
  sourceMetrics.reset();
  resetAllSourceBundles();
});

// ---------- fetch mock 助手 ----------
// vi.stubGlobal 让 fetchWithRetry 内部的全局 fetch 调用走我们的 mock。
// 注意:必须在 beforeEach 重置,避免影响其他测试文件。
function mockFetchSequence(responses: Array<{ status?: number; ok?: boolean; body?: unknown }>) {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = responses[i++] ?? responses[responses.length - 1]!;
    const status = r.status ?? 200;
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null)),
      json: async () => r.body ?? null,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function mockFetchThrow(err: Error) {
  const fn = vi.fn(async () => {
    throw err;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SourceError 分类', () => {
  it('retryable 类别', () => {
    expect(new SourceError('network', 'x').retryable).toBe(true);
    expect(new SourceError('timeout', 'x').retryable).toBe(true);
    expect(new SourceError('rate_limit', 'x').retryable).toBe(true);
    expect(new SourceError('server_5xx', 'x').retryable).toBe(true);
    expect(new SourceError('bad_gateway', 'x').retryable).toBe(true);
    expect(new SourceError('unknown_http', 'x').retryable).toBe(true);
  });

  it('不可重试类别', () => {
    expect(new SourceError('client_4xx', 'x').retryable).toBe(false);
    expect(new SourceError('parse', 'x').retryable).toBe(false);
    expect(new SourceError('circuit_open', 'x').retryable).toBe(false);
    expect(new SourceError('validation', 'x').retryable).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('2xx 一次成功', async () => {
    const fetchMock = mockFetchSequence([{ status: 200, body: { ok: 1 } }]);
    const res = await fetchWithRetry('http://x', {}, { sleep: vi.fn() });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 重试 2 次后成功', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = mockFetchSequence([
      { status: 429 },
      { status: 429 },
      { status: 200, body: { ok: 1 } },
    ]);
    const res = await fetchWithRetry('http://x', {}, { maxRetries: 2, sleep });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('5xx 重试到上限后抛 SourceError', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = mockFetchSequence([
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    await expect(
      fetchWithRetry('http://x', {}, { maxRetries: 2, sleep })
    ).rejects.toBeInstanceOf(SourceError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('4xx 不重试直接抛', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = mockFetchSequence([{ status: 404 }]);
    await expect(
      fetchWithRetry('http://x', {}, { maxRetries: 2, sleep })
    ).rejects.toBeInstanceOf(SourceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('网络错重试到上限后抛 SourceError(network)', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = mockFetchThrow(new Error('ECONNREFUSED'));
    await expect(
      fetchWithRetry('http://x', {}, { maxRetries: 2, sleep })
    ).rejects.toMatchObject({ kind: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maxRetries=0 只尝试一次', async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = mockFetchSequence([{ status: 503 }]);
    await expect(
      fetchWithRetry('http://x', {}, { maxRetries: 0, sleep })
    ).rejects.toBeInstanceOf(SourceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('onAttempt 在每次尝试时回调', async () => {
    const sleep = vi.fn(async () => {});
    mockFetchSequence([{ status: 503 }, { status: 200, body: { ok: 1 } }]);
    const onAttempt = vi.fn();
    await fetchWithRetry('http://x', {}, { maxRetries: 1, sleep, onAttempt });
    // 首次 + 1 次重试
    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(onAttempt.mock.calls[0]![1]).toBeNull();
    expect(onAttempt.mock.calls[1]![1]).toBeInstanceOf(SourceError);
  });
});

describe('TtlCache', () => {
  it('set / get / 过期', () => {
    let now = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 100, now: () => now });
    cache.set('a', 'A');
    expect(cache.get('a')).toBe('A');
    now += 50;
    expect(cache.get('a')).toBe('A');
    now += 60; // 总计 110,过期
    expect(cache.get('a')).toBeUndefined();
  });

  it('delete / clear', () => {
    const cache = createTtlCache<number>({ ttlMs: 1_000 });
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('b')).toBeUndefined();
  });

  it('容量上限淘汰(简化 FIFO)', () => {
    const cache = createTtlCache<number>({ ttlMs: 1_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // 应淘汰 a
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size()).toBe(2);
  });
});

describe('CircuitBreaker', () => {
  it('closed → 累计失败达阈值 → open', () => {
    let now = 1_000;
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000, now: () => now });
    expect(cb.state()).toBe('closed');
    cb.onFailure();
    cb.onFailure();
    expect(cb.state()).toBe('closed');
    cb.onFailure();
    expect(cb.state()).toBe('open');
    expect(cb.canPass()).toBe(false);
  });

  it('open 冷却到期 → half_open,放行探测', () => {
    let now = 1_000;
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 500, now: () => now });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state()).toBe('open');
    expect(cb.canPass()).toBe(false);
    now += 600; // 冷却到期
    expect(cb.state()).toBe('half_open');
    expect(cb.canPass()).toBe(true);
  });

  it('half_open 成功 → closed; 失败 → 再次 open', () => {
    let now = 1_000;
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 500, now: () => now });
    cb.onFailure();
    cb.onFailure();
    now += 600;
    cb.canPass(); // 触发 lazy 降级到 half_open
    cb.onSuccess();
    expect(cb.state()).toBe('closed');
    cb.onFailure();
    cb.onFailure();
    expect(cb.state()).toBe('open');
  });

  it('reset() 立即恢复 closed', () => {
    const cb = createCircuitBreaker({ failureThreshold: 1 });
    cb.onFailure();
    expect(cb.state()).toBe('open');
    cb.reset();
    expect(cb.state()).toBe('closed');
    expect(cb.canPass()).toBe(true);
  });
});

describe('sourceMetrics', () => {
  it('成功 / 失败 / 缓存 / 熔断计数', () => {
    sourceMetrics.recordSuccess('reddit', 100);
    sourceMetrics.recordSuccess('reddit', 200);
    sourceMetrics.recordFailure('reddit', 'network');
    sourceMetrics.recordFailure('reddit', 'rate_limit');
    sourceMetrics.recordCacheHit('reddit');
    sourceMetrics.recordCircuitOpened('reddit');

    const snap = sourceMetrics.snapshot('reddit') as {
      success: number;
      failure: number;
      successRate: number;
      avgLatencyMs: number;
      failureByKind: Record<string, number>;
      cacheHits: number;
      circuitOpened: number;
    };
    expect(snap.success).toBe(2);
    expect(snap.failure).toBe(2);
    expect(snap.total).toBe(4);
    expect(snap.successRate).toBeCloseTo(0.5);
    expect(snap.avgLatencyMs).toBe(150);
    expect(snap.failureByKind).toEqual({ network: 1, rate_limit: 1 });
    expect(snap.cacheHits).toBe(1);
    expect(snap.circuitOpened).toBe(1);
  });

  it('snapshot(无参) 返回所有源快照数组', () => {
    sourceMetrics.recordSuccess('a', 1);
    sourceMetrics.recordSuccess('b', 1);
    const arr = sourceMetrics.snapshot() as Array<{ source: string }>;
    expect(arr.length).toBe(2);
    expect(arr.map((s) => s.source).sort()).toEqual(['a', 'b']);
  });
});

describe('withReliability', () => {
  it('缓存命中: 不调用 fn,记录 cacheHits', async () => {
    const fn = vi.fn(async () => 'ok');
    const r1 = await withReliability({ source: 'src-a', cacheKey: 'k1' }, fn);
    const r2 = await withReliability({ source: 'src-a', cacheKey: 'k1' }, fn);
    expect(r1).toBe('ok');
    expect(r2).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    const snap = sourceMetrics.snapshot('src-a') as {
      cacheHits: number;
      success: number;
    };
    expect(snap.cacheHits).toBe(1);
    expect(snap.success).toBe(1);
  });

  it('成功路径: 写入缓存 + 记录成功', async () => {
    const fn = vi.fn(async () => ({ items: [1, 2] }));
    const r = await withReliability({ source: 'src-b', cacheKey: 'k2' }, fn);
    expect(r).toEqual({ items: [1, 2] });
    // 第二次同 key 命中缓存
    const r2 = await withReliability({ source: 'src-b', cacheKey: 'k2' }, fn);
    expect(r2).toEqual({ items: [1, 2] });
    expect(fn).toHaveBeenCalledTimes(1);
    const snap = sourceMetrics.snapshot('src-b') as { success: number; cacheHits: number };
    expect(snap.success).toBe(1);
    expect(snap.cacheHits).toBe(1);
  });

  it('失败路径: 记录失败 + 触发熔断', async () => {
    const fn = vi.fn(async () => {
      throw new SourceError('rate_limit', '429', { status: 429 });
    });
    await expect(
      withReliability({ source: 'src-c', cacheKey: 'k3' }, fn)
    ).rejects.toBeInstanceOf(SourceError);
    const snap = sourceMetrics.snapshot('src-c') as {
      failure: number;
      failureByKind: Record<string, number>;
    };
    expect(snap.failure).toBe(1);
    expect(snap.failureByKind.rate_limit).toBe(1);
  });

  it('熔断打开时短路,返回 circuit_open SourceError,不调用 fn', async () => {
    const fn = vi.fn(async () => 'ok');
    // 连续失败 5 次(默认阈值)打开熔断
    const failing = vi.fn(async () => {
      throw new SourceError('network', 'down');
    });
    for (let i = 0; i < 5; i++) {
      await withReliability({ source: 'src-d', cacheKey: `k${i}` }, failing).catch(() => undefined);
    }
    // 现在再调用: 应立即抛 circuit_open
    await expect(
      withReliability({ source: 'src-d', cacheKey: 'k99' }, fn)
    ).rejects.toMatchObject({ kind: 'circuit_open' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('不同源相互独立,熔断隔离', async () => {
    const failing = vi.fn(async () => {
      throw new SourceError('network', 'down');
    });
    for (let i = 0; i < 5; i++) {
      await withReliability({ source: 'src-e', cacheKey: `k${i}` }, failing).catch(() => undefined);
    }
    // src-e 熔断,但 src-f 不受影响
    const fn2 = vi.fn(async () => 'good');
    const r = await withReliability({ source: 'src-f', cacheKey: 'k1' }, fn2);
    expect(r).toBe('good');
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

describe('hashKey', () => {
  it('稳定 hash(同样输入同样输出)', () => {
    expect(hashKey('test-key')).toBe(hashKey('test-key'));
  });
  it('不同输入不同输出', () => {
    expect(hashKey('a')).not.toBe(hashKey('b'));
  });
  it('输出长度固定 16 字符', () => {
    expect(hashKey('xxx')).toHaveLength(16);
  });
});

describe('sourceErrorKindToCode', () => {
  /**
   * 该映射被 ResearchService 用于把 SourceError.kind 写到 Execution.error_code。
   * 两侧增加 ErrorCode 时必须同步更新(否则前端会走 fallback 文案)。
   */
  it('逐一映射所有 SourceError.kind', () => {
    expect(sourceErrorKindToCode('network')).toBe('SOURCE_NETWORK');
    expect(sourceErrorKindToCode('timeout')).toBe('SOURCE_TIMEOUT');
    expect(sourceErrorKindToCode('rate_limit')).toBe('SOURCE_RATE_LIMIT');
    expect(sourceErrorKindToCode('server_5xx')).toBe('SOURCE_SERVER_5XX');
    expect(sourceErrorKindToCode('bad_gateway')).toBe('SOURCE_BAD_GATEWAY');
    expect(sourceErrorKindToCode('unknown_http')).toBe('SOURCE_UNKNOWN_HTTP');
    expect(sourceErrorKindToCode('client_4xx')).toBe('SOURCE_CLIENT_4XX');
    expect(sourceErrorKindToCode('parse')).toBe('SOURCE_PARSE');
    expect(sourceErrorKindToCode('circuit_open')).toBe('SOURCE_CIRCUIT_OPEN');
    expect(sourceErrorKindToCode('validation')).toBe('SOURCE_VALIDATION');
  });

  it('未知 kind 走 INTERNAL_ERROR 兜底', () => {
    // @ts-expect-error 故意传错类型以验证运行时兜底
    expect(sourceErrorKindToCode('unknown_kind_xxx')).toBe('INTERNAL_ERROR');
  });
});
