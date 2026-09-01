/**
 * 管理/运维路由 - /api/v1/admin
 *
 * 当前提供:
 *   GET  /admin/llm-retry-metrics          查询各 schema 重试率快照
 *   POST /admin/llm-retry-metrics/reset    清空计数器(调试用)
 *   GET  /admin/llm-cache/stats            查询持久化缓存用量与命中率
 *   POST /admin/llm-cache/clear-expired    主动清理过期记录
 *
 * 设计:
 *   - 无鉴权(与 SettingsService / archives 路由保持一致;InsightForge 当前 MVP 阶段
 *     所有接口都跑在受信内网/本机环境,鉴权留待 v1.3 统一接入)
 *   - 计数器只读,前端/运维手动排查时调用即可
 *   - 业务响应统一走 response.ts 的 ok() 包装,保持与项目其他接口风格一致
 */
import { Router } from 'express';
import {
  getAllMetrics,
  resetMetrics,
  getCacheMetrics,
  resetCacheMetrics,
  type SchemaRetryStats,
  type CacheMetrics,
} from '../services/llm/retryMetrics.js';
import {
  clearExpired,
  getCacheStats,
  type CacheStats,
} from '../services/llm/cache.js';
import {
  getCacheCleanupSchedulerStatus,
  type CacheSchedulerStatus,
} from '../services/llm/cacheScheduler.js';
import {
  getSchedulersStatus,
  type JobStatus,
} from '../services/scheduler/index.js';
import { asyncHandler, ok } from './response.js';

export const adminRouter = Router();

/** 指标快照响应(显式声明,便于前端对接) */
interface RetryMetricsResponse {
  metrics: SchemaRetryStats[];
  snapshotAt: string;
}

/**
 * 查询当前所有 schema 的重试率快照
 * 数组按 retryRate desc 排序,便于一眼定位异常 schema
 */
adminRouter.get(
  '/llm-retry-metrics',
  asyncHandler((_req, res) => {
    const body: RetryMetricsResponse = {
      metrics: getAllMetrics(),
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body);
  })
);

/**
 * 清空所有指标计数器(进程内)
 * 主要用于开发调试与集成测试,生产环境慎用
 */
adminRouter.post(
  '/llm-retry-metrics/reset',
  asyncHandler((_req, res) => {
    resetMetrics();
    const body: RetryMetricsResponse = {
      metrics: getAllMetrics(),
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body, '指标已清空');
  })
);

// ----- v1.5 LLM 缓存 -----

interface LlmCacheStatsResponse {
  /** SQLite 表的持久化统计(总条数 / 活跃 / 过期) */
  cache: CacheStats;
  /** 进程内命中率(从 LLMClient.recordCacheResult 累计) */
  metrics: CacheMetrics[];
  snapshotAt: string;
}

/**
 * 查询持久化缓存用量与进程内命中率
 * 供运营判断缓存收益、容量趋势、命中率走势
 */
adminRouter.get(
  '/llm-cache/stats',
  asyncHandler((_req, res) => {
    const body: LlmCacheStatsResponse = {
      cache: getCacheStats(),
      metrics: getCacheMetrics(),
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body);
  })
);

/**
 * 主动清理过期缓存记录(v1.5)
 * 返回被删除的条数;无过期记录时返回 0
 */
adminRouter.post(
  '/llm-cache/clear-expired',
  asyncHandler((_req, res) => {
    const removed = clearExpired();
    return ok(res, { removed }, removed > 0 ? `已清理 ${removed} 条过期记录` : '无过期记录');
  })
);

/**
 * 清空进程内命中率计数器(不影响 SQLite 表)
 * 与 /llm-retry-metrics/reset 配套,用于排查时归零
 */
adminRouter.post(
  '/llm-cache/metrics-reset',
  asyncHandler((_req, res) => {
    resetCacheMetrics();
    return ok(res, { metrics: getCacheMetrics() }, '缓存指标已清空');
  })
);

// ----- v1.5 LLM 缓存过期清理调度器 -----

interface CacheSchedulerResponse {
  scheduler: CacheSchedulerStatus;
  /** 下次执行相对当前的剩余秒数,便于前端展示「距下次清理 N 小时」 */
  secondsUntilNextRun: number | null;
  snapshotAt: string;
}

/**
 * 查询缓存过期清理调度器的运行状态
 * 供运维/前端监控面板了解清理是否在跑、最近一次清理结果、下次执行时间
 */
adminRouter.get(
  '/llm-cache/scheduler',
  asyncHandler((_req, res) => {
    const scheduler = getCacheCleanupSchedulerStatus();
    const secondsUntilNextRun =
      scheduler.nextRunAt === null
        ? null
        : Math.max(
            0,
            Math.floor((Date.parse(scheduler.nextRunAt) - Date.now()) / 1000)
          );
    const body: CacheSchedulerResponse = {
      scheduler,
      secondsUntilNextRun,
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body);
  })
);

// ----- v1.6 调度注册表(全量 jobs) -----

interface AllSchedulersResponse {
  schedulers: JobStatus[];
  snapshotAt: string;
}

/**
 * 查询当前所有已注册后台任务的运行状态。
 *
 * 与 /llm-cache/scheduler 不同:
 *   - 这里是 registry 层全量视图(未来加「统计聚合」「报告归档」等 job 自动出现)
 *   - /llm-cache/scheduler 保持原字段结构,供老前端兼容
 */
adminRouter.get(
  '/scheduler/status',
  asyncHandler((_req, res) => {
    const body: AllSchedulersResponse = {
      schedulers: getSchedulersStatus(),
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body);
  })
);
