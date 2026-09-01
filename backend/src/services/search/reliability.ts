/**
 * 多源采集引擎 - 可靠性基座
 *
 * 为外部搜索源(HN / Reddit / OpenSerp / SerpAPI)统一提供:
 *   1. 重试: fetchWithRetry - 指数退避,仅对可重试错误(网络/超时/429/5xx)重试
 *   2. 缓存: ttlCache       - 按关键词 hash 的 in-memory TTL 缓存(避免重复打外网)
 *   3. 熔断: circuitBreaker  - 每源独立计数,连续失败自动短路,半开探测恢复
 *   4. 指标: sourceMetrics   - 每源成功率/平均延迟/失败分类,只读快照
 *   5. 编排: withReliability - 把以上能力统一应用到一次源调用
 *
 * 设计原则:
 *   - 零外部依赖,纯内存状态(进程重启清空,可接受)
 *   - 不破坏 searchXxx 客户端对外签名,只需把内部 fetch 包到 withReliability 中
 *   - 全部能力可独立测试,导出 createXxx 系列函数便于 vitest 重置状态
 */
import { logger } from '../../logger.js';

// ----------------------------------------------------------------------------
// 1. 错误分类
// ----------------------------------------------------------------------------

/** 可重试错误类别 */
export type RetryableErrorKind =
  | 'network' // fetch 抛错(DNS / TCP / TLS)
  | 'timeout' // AbortController 触发
  | 'rate_limit' // HTTP 429
  | 'server_5xx' // 5xx
  | 'bad_gateway' // 502/503/504(网关层,通常瞬时)
  | 'unknown_http'; // 其他非 2xx(默认也参与重试,但次数更少)

/** 不可重试错误类别 */
export type NonRetryableErrorKind =
  | 'client_4xx' // 400/401/403/404(参数错或鉴权,重试无意义)
  | 'parse' // 解析响应失败
  | 'circuit_open' // 熔断中
  | 'validation'; // 入参校验失败

export type ErrorKind = RetryableErrorKind | NonRetryableErrorKind;

/** 统一的错误对象,可重试与否由 retryable 字段决定 */
export class SourceError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;
  constructor(kind: ErrorKind, message: string, opts?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = 'SourceError';
    this.kind = kind;
    this.retryable = isRetryable(kind);
    this.status = opts?.status;
    this.cause = opts?.cause;
  }
}

function isRetryable(kind: ErrorKind): boolean {
  switch (kind) {
    case 'network':
    case 'timeout':
    case 'rate_limit':
    case 'server_5xx':
    case 'bad_gateway':
    case 'unknown_http':
      return true;
    case 'client_4xx':
    case 'parse':
    case 'circuit_open':
    case 'validation':
      return false;
  }
}

/** 把 fetch 抛出的错归类(供 fetchWithRetry 内部使用) */
function classifyFetchError(err: unknown, status?: number): SourceError {
  if (err instanceof SourceError) return err;
  if (status !== undefined) {
    if (status === 429) return new SourceError('rate_limit', `HTTP 429`, { status, cause: err });
    if (status >= 500 && status < 600)
      return new SourceError('server_5xx', `HTTP ${status}`, { status, cause: err });
    if (status === 502 || status === 503 || status === 504)
      return new SourceError('bad_gateway', `HTTP ${status}`, { status, cause: err });
    if (status >= 400 && status < 500)
      return new SourceError('client_4xx', `HTTP ${status}`, { status, cause: err });
    return new SourceError('unknown_http', `HTTP ${status}`, { status, cause: err });
  }
  // 没有 status 通常是 fetch 抛错
  if (err instanceof Error && /abort/i.test(err.message)) {
    return new SourceError('timeout', `timeout: ${err.message}`, { cause: err });
  }
  return new SourceError('network', err instanceof Error ? err.message : String(err), { cause: err });
}

// ----------------------------------------------------------------------------
// 2. 重试: fetchWithRetry
// ----------------------------------------------------------------------------

export interface RetryOptions {
  /** 最大重试次数(含首次失败后追加的重试,默认 2) */
  maxRetries?: number;
  /** 首次重试前的等待基数(ms),实际等待 = base * 2^attempt + 抖动 */
  baseDelayMs?: number;
  /** 单次最大等待(ms),防止退避过长 */
  maxDelayMs?: number;
  /** 自定义判断: 返回 true 表示当前错误可重试,默认按 kind.retryable */
  shouldRetry?: (err: SourceError, attempt: number) => boolean;
  /** 调用前的钩子(用于指标 / 埋点);attempt 从 0 开始 */
  onAttempt?: (attempt: number, err: SourceError | null) => void;
  /** 自定义 sleep(测试时注入,避免真实等待) */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 带重试的 fetch 包装。
 * - 仅对 SourceError(kind=retryable) 或网络/超时错进行重试
 * - 退避策略: 指数 + 抖动,带上限
 * - 整体单次超时由调用方在 fetchOptions.signal 中传入(本函数不重复计 timeout)
 *
 * 抛出: 最后一次失败的 SourceError(不可重试时立刻抛)
 */
export async function fetchWithRetry(
  url: string,
  fetchOptions: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const maxRetries = Math.max(0, retryOptions.maxRetries ?? 2);
  const baseDelay = Math.max(0, retryOptions.baseDelayMs ?? 800);
  const maxDelay = Math.max(baseDelay, retryOptions.maxDelayMs ?? 5_000);
  const sleep = retryOptions.sleep ?? DEFAULT_SLEEP;
  const shouldRetry =
    retryOptions.shouldRetry ?? ((err: SourceError) => err.retryable);

  let lastErr: SourceError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    retryOptions.onAttempt?.(attempt, lastErr);
    try {
      const res = await fetch(url, fetchOptions);
      if (res.ok) return res;
      // 非 2xx:分类,按是否可重试决定下一步
      const err = classifyFetchError(null, res.status);
      // 4xx 立刻放弃,5xx/429 重试
      if (!err.retryable || attempt === maxRetries) {
        // 读到响应体后丢弃,避免连接占用
        try {
          await res.text();
        } catch {
          /* noop */
        }
        throw err;
      }
      lastErr = err;
      const wait = computeBackoff(attempt, baseDelay, maxDelay);
      logger.warn(
        { url, status: res.status, attempt: attempt + 1, wait },
        'fetchWithRetry: 失败,准备退避重试'
      );
      await sleep(wait);
    } catch (err) {
      // fetch 抛错(网络/超时/abort)
      const e = err instanceof SourceError ? err : classifyFetchError(err);
      if (!e.retryable || attempt === maxRetries) throw e;
      if (!shouldRetry(e, attempt)) throw e;
      lastErr = e;
      const wait = computeBackoff(attempt, baseDelay, maxDelay);
      logger.warn(
        { url, kind: e.kind, attempt: attempt + 1, wait, msg: e.message },
        'fetchWithRetry: 异常,准备退避重试'
      );
      await sleep(wait);
    }
  }
  // 不可达(循环条件保证)
  throw lastErr ?? new SourceError('unknown_http', 'fetchWithRetry: 未知失败');
}

/** 指数退避 + 抖动(0~25% 抖动) */
function computeBackoff(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** attempt);
  const jitter = Math.floor(exp * Math.random() * 0.25);
  return exp + jitter;
}

// ----------------------------------------------------------------------------
// 3. 缓存: ttlCache
// ----------------------------------------------------------------------------

export interface TtlCacheOptions<V> {
  /** 过期时间(ms) */
  ttlMs: number;
  /** 最大条目数(超出按 LRU 简单淘汰);可选,默认无限 */
  maxEntries?: number;
  /** 时间源,默认 Date.now;测试时可注入 */
  now?: () => number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

/**
 * 简单的 in-memory TTL 缓存(进程级,重启即清)。
 * - 命中即跳过 fetch,避免重复打外网
 * - maxEntries 超出时按插入顺序淘汰(简化的 FIFO,够用)
 */
export function createTtlCache<V>(opts: TtlCacheOptions<V>): TtlCache<V> {
  const now = opts.now ?? Date.now;
  const ttl = Math.max(0, opts.ttlMs);
  const map = new Map<string, CacheEntry<V>>();
  const max = opts.maxEntries ?? Infinity;

  function evictExpired() {
    const t = now();
    for (const [k, v] of map) {
      if (v.expiresAt <= t) map.delete(k);
    }
  }

  function enforceMax() {
    while (map.size > max) {
      const firstKey = map.keys().next().value;
      if (firstKey === undefined) break;
      map.delete(firstKey);
    }
  }

  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (e.expiresAt <= now()) {
        map.delete(key);
        return undefined;
      }
      return e.value;
    },
    set(key, value) {
      evictExpired();
      map.set(key, { value, expiresAt: now() + ttl });
      enforceMax();
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

// ----------------------------------------------------------------------------
// 4. 熔断器: circuitBreaker
// ----------------------------------------------------------------------------

export interface CircuitBreakerOptions {
  /** 连续失败阈值,达到后打开熔断(默认 5) */
  failureThreshold?: number;
  /** 打开后冷却时间(ms);冷却到期后转为 half-open,放行一次探测(默认 30s) */
  cooldownMs?: number;
  /** 时间源,默认 Date.now;测试时可注入 */
  now?: () => number;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreaker {
  /** 当前是否允许放行(closed / half_open 都放行) */
  canPass(): boolean;
  /** 记录成功: 关闭熔断 + 清零失败计数 */
  onSuccess(): void;
  /** 记录失败: 计数+1,达阈值则打开熔断 */
  onFailure(): void;
  /** 读取当前状态(供 metrics / 健康检查) */
  state(): CircuitState;
  /** 重置(测试或管理员手动恢复) */
  reset(): void;
}

/**
 * 简单的熔断器:
 * - closed: 正常放行,失败计数累积
 * - open: 冷却期内直接拒绝(canPass=false),不发起请求
 * - half_open: 冷却到期,放行一次探测;成功→closed,失败→再次 open
 *
 * 设计上不阻塞其他源,每个 sourceName 持独立实例
 */
export function createCircuitBreaker(opts: CircuitBreakerOptions = {}): CircuitBreaker {
  const threshold = Math.max(1, opts.failureThreshold ?? 5);
  const cooldown = Math.max(0, opts.cooldownMs ?? 30_000);
  const now = opts.now ?? Date.now;

  let state: CircuitState = 'closed';
  let consecutiveFailures = 0;
  let openedAt = 0;

  return {
    canPass() {
      if (state === 'closed') return true;
      if (state === 'open') {
        if (now() - openedAt >= cooldown) {
          state = 'half_open';
          return true;
        }
        return false;
      }
      // half_open: 也放行(若已有进行中的探测,上游并发控制负责)
      return true;
    },
    onSuccess() {
      consecutiveFailures = 0;
      state = 'closed';
    },
    onFailure() {
      consecutiveFailures += 1;
      if (state === 'half_open') {
        // 探测失败,重新打开
        state = 'open';
        openedAt = now();
        return;
      }
      if (consecutiveFailures >= threshold) {
        state = 'open';
        openedAt = now();
      }
    },
    state() {
      // lazy transition: 读取时若 open 已冷却完,自动降级到 half_open
      if (state === 'open' && now() - openedAt >= cooldown) {
        state = 'half_open';
      }
      return state;
    },
    reset() {
      state = 'closed';
      consecutiveFailures = 0;
      openedAt = 0;
    },
  };
}

// ----------------------------------------------------------------------------
// 5. 指标: sourceMetrics
// ----------------------------------------------------------------------------

export interface SourceMetricsSnapshot {
  source: string;
  success: number;
  failure: number;
  total: number;
  /** 成功率(0~1);无请求时为 1 */
  successRate: number;
  /** 平均延迟(ms);仅基于成功样本 */
  avgLatencyMs: number;
  /** 按错误类别的失败计数 */
  failureByKind: Record<string, number>;
  /** 缓存命中次数 */
  cacheHits: number;
  /** 熔断触发次数(累计:进入 open 状态的次数) */
  circuitOpened: number;
}

interface SourceStats {
  source: string;
  success: number;
  failure: number;
  totalLatencyMs: number;
  failureByKind: Record<string, number>;
  cacheHits: number;
  circuitOpened: number;
}

export interface SourceMetrics {
  /** 记录一次成功(供 withReliability 内部调用) */
  recordSuccess(source: string, latencyMs: number): void;
  /** 记录一次失败(供 withReliability 内部调用) */
  recordFailure(source: string, kind: ErrorKind): void;
  /** 记录缓存命中 */
  recordCacheHit(source: string): void;
  /** 记录熔断打开事件 */
  recordCircuitOpened(source: string): void;
  /** 导出快照(供 API 或调试) */
  snapshot(source?: string): SourceMetricsSnapshot | SourceMetricsSnapshot[];
  /** 重置全部(测试) */
  reset(): void;
}

function emptyStats(source: string): SourceStats {
  return {
    source,
    success: 0,
    failure: 0,
    totalLatencyMs: 0,
    failureByKind: {},
    cacheHits: 0,
    circuitOpened: 0,
  };
}

/**
 * 全局单例:整个进程共用一份指标。
 * 测试可通过 metrics.reset() 清空。
 */
export const sourceMetrics: SourceMetrics = (() => {
  const stats = new Map<string, SourceStats>();

  function get(source: string): SourceStats {
    let s = stats.get(source);
    if (!s) {
      s = emptyStats(source);
      stats.set(source, s);
    }
    return s;
  }

  function toSnapshot(s: SourceStats): SourceMetricsSnapshot {
    const total = s.success + s.failure;
    return {
      source: s.source,
      success: s.success,
      failure: s.failure,
      total,
      successRate: total === 0 ? 1 : s.success / total,
      avgLatencyMs: s.success === 0 ? 0 : Math.round(s.totalLatencyMs / s.success),
      failureByKind: { ...s.failureByKind },
      cacheHits: s.cacheHits,
      circuitOpened: s.circuitOpened,
    };
  }

  return {
    recordSuccess(source, latencyMs) {
      const s = get(source);
      s.success += 1;
      s.totalLatencyMs += Math.max(0, latencyMs);
    },
    recordFailure(source, kind) {
      const s = get(source);
      s.failure += 1;
      s.failureByKind[kind] = (s.failureByKind[kind] ?? 0) + 1;
    },
    recordCacheHit(source) {
      const s = get(source);
      s.cacheHits += 1;
    },
    recordCircuitOpened(source) {
      const s = get(source);
      s.circuitOpened += 1;
    },
    snapshot(source) {
      if (source) {
        const s = get(source);
        return toSnapshot(s);
      }
      return Array.from(stats.values()).map(toSnapshot);
    },
    reset() {
      stats.clear();
    },
  };
})();

// ----------------------------------------------------------------------------
// 6. 编排: withReliability
// ----------------------------------------------------------------------------

export interface ReliabilityOptions {
  /** 源名(用于指标/熔断 key),必填 */
  source: string;
  /** 缓存 key(由调用方基于关键词等参数计算);若不传则不缓存 */
  cacheKey?: string;
  /** TTL 缓存(若未传则内部创建一个默认 5min 的;同一源共享以复用) */
  cache?: TtlCache<unknown>;
  /** 熔断器(若未传则内部创建一个默认阈值的;同一源共享以复用) */
  breaker?: CircuitBreaker;
  /** 重试参数 */
  retry?: RetryOptions;
}

interface SourceBundle {
  cache: TtlCache<unknown>;
  breaker: CircuitBreaker;
}

const bundles = new Map<string, SourceBundle>();

/** 获取或创建某源的共享 bundle(默认 TTL 5min,熔断 5 连败 30s 冷却) */
export function getSourceBundle(source: string): SourceBundle {
  let b = bundles.get(source);
  if (!b) {
    b = {
      cache: createTtlCache<unknown>({ ttlMs: 5 * 60_000, maxEntries: 256 }),
      breaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 }),
    };
    bundles.set(source, b);
  }
  return b;
}

/** 重置某源的 bundle(测试用) */
export function resetSourceBundle(source: string): void {
  bundles.delete(source);
}

/** 重置全部 bundle(测试用) */
export function resetAllSourceBundles(): void {
  bundles.clear();
}

/**
 * 一次性快照所有源的熔断状态(供健康检查路由使用)。
 * - 包含所有当前已创建的 bundle,以及 sourceMetrics 已记录但尚未触发 bundle 创建的源
 * - state() 调用会触发 lazy 转换(open → half_open),安全无副作用
 */
export interface SourceHealthSummary {
  source: string;
  state: CircuitState;
  metrics: SourceMetricsSnapshot;
}

export function snapshotSourceHealth(): SourceHealthSummary[] {
  const result: SourceHealthSummary[] = [];
  const metricsList = sourceMetrics.snapshot() as SourceMetricsSnapshot[];
  const metricsByName = new Map(metricsList.map((m) => [m.source, m] as const));
  // 合并 bundle 与 metrics 两边的 key
  const allSources = new Set<string>([...bundles.keys(), ...metricsByName.keys()]);
  for (const source of allSources) {
    const bundle = bundles.get(source);
    // 注意:state() 会触发 lazy open→half_open 转换,语义上是「此刻的熔断状态」
    const state: CircuitState = bundle ? bundle.breaker.state() : 'closed';
    const metrics =
      metricsByName.get(source) ??
      // 调用过 withReliability 一定会 record,这里走 metrics;未有调用时给个全零快照。
      // snapshot 传入 source 参数时实际返回单对象,此处断言以收窄联合类型。
      (sourceMetrics.snapshot(source) as SourceMetricsSnapshot);
    result.push({ source, state, metrics });
  }
  result.sort((a, b) => a.source.localeCompare(b.source));
  return result;
}

/**
 * 重置某源的 bundle + metrics(开发调试用,生产慎用)。
 * 返回 true 表示存在该源并已重置。
 */
export function resetSource(source: string): boolean {
  const existed = bundles.delete(source);
  // sourceMetrics 不提供单源删除,这里整体 reset 影响其他源,不采用;
  // 调用方需先 recordSuccess 一条以让快照重新出现。
  return existed;
}

/**
 * 把一次"调用源"的函数包装为带重试+熔断+缓存+指标的形式:
 *   1. 熔断打开 → 立即抛 SourceError('circuit_open')(不计入失败,避免反馈循环)
 *   2. 缓存命中 → 直接返回,recordCacheHit
 *   3. 执行业务 fn;成功后:写入缓存 + 记录成功 + 关闭熔断
 *      失败后:记录失败 + 触发熔断;若可重试,在内部完成重试(由 fn 自己或上层做)
 *
 * 注意: 重试在 fn 内部完成(各 Client 自行调用 fetchWithRetry);本函数负责
 * 缓存与熔断/指标的副作用,以及"不可重试错误的统一封装"。
 */
export async function withReliability<T>(
  opts: ReliabilityOptions,
  fn: () => Promise<T>
): Promise<T> {
  const bundle = opts.cache && opts.breaker
    ? { cache: opts.cache as TtlCache<unknown>, breaker: opts.breaker }
    : getSourceBundle(opts.source);

  // 熔断检查
  if (!bundle.breaker.canPass()) {
    sourceMetrics.recordCircuitOpened(opts.source);
    throw new SourceError('circuit_open', `${opts.source} 熔断中,跳过`);
  }

  // 缓存查询
  if (opts.cacheKey !== undefined) {
    const hit = bundle.cache.get(opts.cacheKey);
    if (hit !== undefined) {
      sourceMetrics.recordCacheHit(opts.source);
      logger.debug({ source: opts.source, cacheKey: opts.cacheKey }, 'withReliability: 缓存命中');
      return hit as T;
    }
  }

  const start = Date.now();
  try {
    const value = await fn();
    const latency = Date.now() - start;
    bundle.breaker.onSuccess();
    sourceMetrics.recordSuccess(opts.source, latency);
    if (opts.cacheKey !== undefined) {
      bundle.cache.set(opts.cacheKey, value);
    }
    return value;
  } catch (err) {
    // SourceError(可重试)已经被 fn 内部重试到顶,这里只负责记账
    const se = err instanceof SourceError ? err : new SourceError('network', String(err), { cause: err });
    bundle.breaker.onFailure();
    sourceMetrics.recordFailure(opts.source, se.kind);
    // 仅当状态从 closed → open 那一刻记录一次 circuitOpened 事件
    if (bundle.breaker.state() === 'open') {
      sourceMetrics.recordCircuitOpened(opts.source);
    }
    throw se;
  }
}

// ----------------------------------------------------------------------------
// 工具: 统一 hash 缓存 key(避免超长 key)
// ----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/** 稳定 hash: 对 cache key 做 SHA1 截断,避免 key 含特殊字符导致日志污染 */
export function hashKey(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

// ----------------------------------------------------------------------------
// 工具: SourceError.kind -> ErrorCode 映射(供 ResearchService 写入 execution.error_code)
// ----------------------------------------------------------------------------

import type { ErrorCode } from '../../types/index.js';

/**
 * 把 SourceError.kind 映射为前端的 ErrorCode。
 * - 类型对齐(后端 SourceError ↔ 前端 ErrorCode 一一对应)
 * - unknown kind 返回 INTERNAL_ERROR 兜底
 */
export function sourceErrorKindToCode(kind: string): ErrorCode {
  switch (kind) {
    case 'network':
      return 'SOURCE_NETWORK';
    case 'timeout':
      return 'SOURCE_TIMEOUT';
    case 'rate_limit':
      return 'SOURCE_RATE_LIMIT';
    case 'server_5xx':
      return 'SOURCE_SERVER_5XX';
    case 'bad_gateway':
      return 'SOURCE_BAD_GATEWAY';
    case 'unknown_http':
      return 'SOURCE_UNKNOWN_HTTP';
    case 'client_4xx':
      return 'SOURCE_CLIENT_4XX';
    case 'parse':
      return 'SOURCE_PARSE';
    case 'circuit_open':
      return 'SOURCE_CIRCUIT_OPEN';
    case 'validation':
      return 'SOURCE_VALIDATION';
    default:
      return 'INTERNAL_ERROR';
  }
}
