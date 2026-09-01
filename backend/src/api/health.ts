/**
 * 健康检查路由 - /api/v1/health
 *
 * 当前提供(路线图阶段 1.1 / v1.6):
 *   GET  /health/system         系统级健康( DB ping / LLM 配置 / 缓存 / 调度器)
 *   GET  /health/sources         多源采集引擎健康快照(指标 + 熔断状态)
 *   GET  /health/sources/:name   单个源的详细快照(供前端诊断面板定位)
 *
 * 设计:
 *   - 无鉴权(与 admin 路由保持一致;MVP 阶段所有接口都跑在受信内网/本机环境,
 *     鉴权留待 v2.0 集中接入)
 *   - 状态聚合:
 *       healthy   : 所有源 closed + 成功率 >= 80%
 *       degraded  : 有源处于 half_open 或成功率 50%~80%
 *       unhealthy : 有源熔断打开(open)或成功率 < 50%
 *   - 响应统一走 response.ts 的 ok() 包装,与项目其他接口风格一致
 */
import { Router } from 'express';
import {
  snapshotSourceHealth,
  type SourceHealthSummary,
  type SourceMetricsSnapshot,
} from '../services/search/reliability.js';
import { asyncHandler, ok, serverError } from './response.js';
import { getDb } from '../db/index.js';
import { config, getLlmApiKey } from '../config.js';
import {
  getCacheStats,
  isCacheEnabled,
  type CacheStats,
} from '../services/llm/cache.js';
import {
  getCacheCleanupSchedulerStatus,
  type CacheSchedulerStatus,
} from '../services/llm/cacheScheduler.js';

export const healthRouter = Router();

/** 单源健康摘要 */
type SourceHealth = SourceHealthSummary;

/** 整体健康状态 */
type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

/** GET /health/sources 响应 */
interface HealthResponse {
  status: OverallStatus;
  sources: SourceHealth[];
  snapshotAt: string;
  /** 顶层汇总,便于前端无需遍历 */
  summary: {
    total: number;
    open: number;
    halfOpen: number;
    closed: number;
    avgSuccessRate: number;
  };
}

/**
 * 计算整体状态。
 * - 任何源 open → unhealthy
 * - 任何源 half_open 或 平均成功率 < 0.8 → degraded
 * - 否则 healthy
 */
function computeOverallStatus(sources: SourceHealth[]): OverallStatus {
  if (sources.some((s) => s.state === 'open')) return 'unhealthy';
  if (sources.some((s) => s.state === 'half_open')) return 'degraded';
  if (sources.length === 0) return 'healthy';
  const avg = sources.reduce((acc, s) => acc + s.metrics.successRate, 0) / sources.length;
  if (avg < 0.5) return 'unhealthy';
  if (avg < 0.8) return 'degraded';
  return 'healthy';
}

/** 把汇总状态映射到 HTTP code(便于外部探针用 status code 判断) */
function statusToHttp(status: OverallStatus): number {
  switch (status) {
    case 'healthy':
      return 200;
    case 'degraded':
      return 200; // 仍可用,仅提示
    case 'unhealthy':
      return 503; // 熔断中有源不可用,告知上游降级
  }
}

/**
 * GET /health/sources
 * 返回所有数据源的健康快照;HTTP 状态码随整体状态变化:
 *   healthy / degraded → 200, unhealthy → 503
 */
healthRouter.get(
  '/sources',
  asyncHandler((_req, res) => {
    try {
      const sources = snapshotSourceHealth();
      const status = computeOverallStatus(sources);
      const summary = sources.reduce(
        (acc, s) => {
          acc.total += 1;
          if (s.state === 'open') acc.open += 1;
          else if (s.state === 'half_open') acc.halfOpen += 1;
          else acc.closed += 1;
          acc.avgSuccessRate += s.metrics.successRate;
          return acc;
        },
        { total: 0, open: 0, halfOpen: 0, closed: 0, avgSuccessRate: 0 }
      );
      if (summary.total > 0) summary.avgSuccessRate /= summary.total;

      const body: HealthResponse = {
        status,
        sources,
        snapshotAt: new Date().toISOString(),
        summary,
      };
      res.status(statusToHttp(status)).json({
        code: status === 'unhealthy' ? 503 : 0,
        message: status,
        data: body,
      });
    } catch (err) {
      serverError(res, err);
    }
  })
);

/** 单源详情响应 */
interface SingleSourceResponse {
  source: SourceHealth;
  snapshotAt: string;
}

/**
 * GET /health/sources/:name
 * 返回指定源的详细健康快照(供前端诊断面板定位)。
 * 若该源从未被调用过,metrics 全零 + state=closed,这是合法返回。
 */
healthRouter.get(
  '/sources/:name',
  asyncHandler<{ params: { name: string } }>((req, res) => {
    const name = req.params.name;
    const all = snapshotSourceHealth();
    const found = all.find((s) => s.source === name);
    if (!found) {
      // 该源从未触发,返回「未观察到活动」而非 404,便于前端诊断面板统一处理
      const body: SingleSourceResponse = {
        source: {
          source: name,
          state: 'closed',
          metrics: {
            source: name,
            success: 0,
            failure: 0,
            total: 0,
            successRate: 1,
            avgLatencyMs: 0,
            failureByKind: {},
            cacheHits: 0,
            circuitOpened: 0,
          } satisfies SourceMetricsSnapshot,
        },
        snapshotAt: new Date().toISOString(),
      };
      return ok(res, body);
    }
    const body: SingleSourceResponse = {
      source: found,
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body);
  })
);

// ----- v1.6 系统级健康检查 -----

interface DbHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

interface LlmHealth {
  provider: string;
  model: string;
  /** 是否已配置 API Key(或为 Ollama 这种不需要 Key 的 provider) */
  configured: boolean;
}

interface CacheHealth {
  enabled: boolean;
  total: number;
  active: number;
  expired: number;
}

interface SystemHealthResponse {
  status: OverallStatus;
  checkedAt: string;
  uptime: number;
  db: DbHealth;
  llm: LlmHealth;
  cache: CacheHealth;
  scheduler: CacheSchedulerStatus;
  /** 不致命但值得注意的项,聚合到 status=degraded 时使用 */
  issues: string[];
}

/**
 * 系统级健康检查:
 *   - DB: SELECT 1 + 测量延迟;失败 → unhealthy(503)
 *   - LLM: provider 是否已配置 Key(或 Ollama);未配置 → degraded
 *   - Cache: 是否启用 + 体量;total > 50_000 → degraded(提示清理)
 *   - Scheduler: 暴露运行状态便于排查
 *
 * HTTP code 规则同 /health/sources:
 *   healthy / degraded → 200, unhealthy → 503
 */
healthRouter.get(
  '/system',
  asyncHandler((_req, res) => {
    const issues: string[] = [];

    // 1. DB ping
    const dbStart = Date.now();
    let dbOk = false;
    let dbError: string | undefined;
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
      issues.push(`db: ${dbError}`);
    }
    const dbLatencyMs = Date.now() - dbStart;
    const db: DbHealth = { ok: dbOk, latencyMs: dbLatencyMs, error: dbError };

    // 2. LLM provider 配置存在性
    const llmConfigured = !!getLlmApiKey() || config.LLM_PROVIDER === 'ollama';
    const llm: LlmHealth = {
      provider: config.LLM_PROVIDER,
      model: config.LLM_MODEL,
      configured: llmConfigured,
    };
    if (!llmConfigured) {
      issues.push(`llm: provider=${config.LLM_PROVIDER} 未配置 API Key`);
    }

    // 3. Cache 状态(禁用时 getCacheStats 返回空对象,这里也直接走空)
    const cacheEnabled = isCacheEnabled();
    let cacheStats: CacheStats = {
      total: 0,
      active: 0,
      expired: 0,
      bySchema: [],
    };
    if (cacheEnabled) {
      try {
        cacheStats = getCacheStats();
      } catch {
        // getCacheStats 内部已 try/catch,这里兜底
      }
    }
    const cache: CacheHealth = {
      enabled: cacheEnabled,
      total: cacheStats.total,
      active: cacheStats.active,
      expired: cacheStats.expired,
    };
    if (!cacheEnabled) {
      issues.push('cache: 全局开关关闭 (INSIGHTFORGE_LLM_CACHE_ENABLED)');
    }
    // 容量告警阈值: 5 万条视为偏高
    if (cacheStats.total > 50_000) {
      issues.push(
        `cache: 总记录 ${cacheStats.total} 偏高,可考虑调小 TTL 或手动清理`
      );
    }

    // 4. Scheduler
    const scheduler = getCacheCleanupSchedulerStatus();
    if (!scheduler.running) {
      issues.push('scheduler: 缓存过期清理调度器未运行');
    }

    // 5. 聚合状态
    let status: OverallStatus = 'healthy';
    if (!dbOk) {
      status = 'unhealthy';
    } else if (issues.length > 0) {
      status = 'degraded';
    }

    const body: SystemHealthResponse = {
      status,
      checkedAt: new Date().toISOString(),
      uptime: process.uptime(),
      db,
      llm,
      cache,
      scheduler,
      issues,
    };
    res.status(statusToHttp(status)).json({
      code: status === 'unhealthy' ? 503 : 0,
      message: status,
      data: body,
    });
  })
);
