/**
 * v1.5 LLM 缓存过期清理调度器
 *
 * v1.6 重构:
 *   - 原单文件 setTimeout/setInterval 逻辑已迁移到 services/scheduler/registry
 *   - 本文件现在仅负责: 1) 暴露 ensureCacheCleanupRegistered() 给 scheduler 入口;
 *                        2) 桥接旧接口 getCacheCleanupSchedulerStatus() 保持向后兼容;
 *                        3) 提供 start/stop 函数语义包装,供老调用方继续可用
 *
 * 设计:
 *   - 注册到 registry 的 name 为 'llm-cache-cleanup'
 *   - run() 内部调用 clearExpired();返回数字会被 registry 记入 lastRemoved
 *   - 缓存全局关闭时,run() 返回 0 并 log debug,不抛错
 *
 * 测试可见性:
 *   - getCacheCleanupSchedulerStatus() 仍供 /admin/llm-cache/scheduler 暴露
 *   - 与 registry 的 getStatus 等价,字段对齐 CacheSchedulerStatus 兼容老响应
 */
import { clearExpired, isCacheEnabled } from './cache.js';
import { schedulerRegistry } from '../scheduler/registry.js';
import { logger } from '../../logger.js';

/** 默认周期(小时) */
const DEFAULT_INTERVAL_HOURS = 24;
/** 默认首次延迟(秒) */
const DEFAULT_FIRST_DELAY_SEC = 60;

/** 周期下限(小时),防止误配成 1 秒级把 SQLite 写爆 */
const MIN_INTERVAL_HOURS = 1;

/** 缓存清理 job 的固定 name,供 scheduler 入口引用 */
export const LLM_CACHE_CLEANUP_JOB_NAME = 'llm-cache-cleanup';

/**
 * 解析周期(小时)。未配置 / 非法 / 小于 MIN 都回退到默认 24h。
 * 延迟求值:registry 每次 start 都会重新调用,允许运行时调整后下次启动生效。
 */
function getIntervalHours(): number {
  const raw = process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS;
  if (raw == null) return DEFAULT_INTERVAL_HOURS;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < MIN_INTERVAL_HOURS) return DEFAULT_INTERVAL_HOURS;
  return n;
}

/**
 * 解析首次延迟(秒)。未配置 / 非法 / 负数 都回退到默认 60s。
 */
function getFirstDelaySec(): number {
  const raw = process.env.INSIGHTFORGE_LLM_CACHE_CLEANUP_FIRST_DELAY_SEC;
  if (raw == null) return DEFAULT_FIRST_DELAY_SEC;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FIRST_DELAY_SEC;
  return n;
}

/**
 * 单次执行:返回删除条数;失败返回 0 不抛错
 * (cache.ts 内部已 try/catch + warn,这里只是包装层)
 */
async function runCacheCleanup(): Promise<number> {
  if (!isCacheEnabled()) {
    // 缓存全局关闭时,清理无意义,但仍写一条 log 便于排查
    logger.debug('LLM 缓存关闭中,跳过过期清理');
    return 0;
  }
  try {
    return clearExpired();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'LLM 缓存过期清理执行异常'
    );
    return 0;
  }
}

/**
 * 注册 LLM 缓存清理 job 到 scheduler registry。
 * 幂等:已注册则 no-op;供 scheduler/index.ts 的 ensureBuiltinSchedulersRegistered 调用。
 */
export function ensureCacheCleanupRegistered(): void {
  if (schedulerRegistry.has(LLM_CACHE_CLEANUP_JOB_NAME)) return;
  schedulerRegistry.register({
    name: LLM_CACHE_CLEANUP_JOB_NAME,
    getIntervalMs: () => getIntervalHours() * 3600_000,
    getFirstDelayMs: () => getFirstDelaySec() * 1000,
    run: runCacheCleanup,
  });
}

/** 旧版对外暴露的状态结构(保持字段命名,便于 admin.ts 不改) */
export interface CacheSchedulerStatus {
  /** 调度器是否在跑 */
  running: boolean;
  /** 周期(毫秒) */
  intervalMs: number;
  /** 首次延迟(毫秒) */
  firstDelayMs: number;
  /** 上次执行时间(ISO string) */
  lastRunAt: string | null;
  /** 上次删除记录数 */
  lastRemoved: number | null;
  /** 上次执行耗时(毫秒) */
  lastDurationMs: number | null;
  /** 下次执行时间(ISO string) */
  nextRunAt: string | null;
}

/** 旧版 start 函数(保留向后兼容):内部走 registry */
export function startCacheCleanupScheduler(): void {
  ensureCacheCleanupRegistered();
  schedulerRegistry.start(LLM_CACHE_CLEANUP_JOB_NAME);
}

/** 旧版 stop 函数:内部走 registry */
export function stopCacheCleanupScheduler(): void {
  schedulerRegistry.stop(LLM_CACHE_CLEANUP_JOB_NAME);
}

/**
 * 当前调度器状态(供 /admin/llm-cache/scheduler 与 /health/system 共用)。
 * 内部转调 registry.getStatus,字段对齐老版本以便老调用方零修改。
 */
export function getCacheCleanupSchedulerStatus(): CacheSchedulerStatus {
  const status = schedulerRegistry.getStatus(LLM_CACHE_CLEANUP_JOB_NAME);
  if (!status) {
    return {
      running: false,
      intervalMs: 0,
      firstDelayMs: 0,
      lastRunAt: null,
      lastRemoved: null,
      lastDurationMs: null,
      nextRunAt: null,
    };
  }
  return {
    running: status.running,
    intervalMs: status.intervalMs,
    firstDelayMs: status.firstDelayMs,
    lastRunAt: status.lastRunAt,
    lastRemoved: status.lastRemoved,
    lastDurationMs: status.lastDurationMs,
    nextRunAt: status.nextRunAt,
  };
}

/**
 * 仅供测试使用:停止并注销,保证测试隔离。
 * 与原版的 _resetCacheCleanupSchedulerForTest() 行为对齐。
 */
export function _resetCacheCleanupSchedulerForTest(): void {
  schedulerRegistry.unregister(LLM_CACHE_CLEANUP_JOB_NAME);
}
