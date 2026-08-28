/**
 * LLM schema 重试率指标聚合
 *
 * 目的:
 *   当某个 zod schema 的重试率持续偏高,通常意味着:
 *     - schema 过严(约束超出当前模型能力范围,如要求特定枚举值超出领域常识)
 *     - prompt 描述不清(字段含义歧义、必填标识不明显)
 *     - 模型能力与任务不匹配(在低端模型上跑复杂结构化输出)
 *   反之,重试率长期为 0 也未必是好事:可能是 schema 过松、漏校验、或者
 *   模型只是没遇到挑战性的输入。本模块提供 "够用" 的可观测性:
 *     - recordRetryResult(): 在 chatJsonWithSchemaRetry 每次完成后调用
 *     - getAllMetrics(): 通过 API 暴露给前端 / 运维手动排查
 *     - getStrictSchemaWarnings(): 后台定时器用它筛出可疑 schema 并 warn
 *
 * 存储策略:
 *   - 内存 Map,进程重启清零(符合 MVP 场景,与 BusinessPlanService / TechSelectionService 一致)
 *   - 单线程 Node,无需锁
 *   - schemaName 由调用方显式传入,避免反射推断带来的歧义
 *
 * 告警策略:
 *   - retryRate > STRICT_THRESHOLD(=0.3) 的 schema 视为可疑
 *   - 后台 setInterval 每 30 分钟调用一次,有可疑 schema 时才 log warn(避免噪音)
 *   - 测试用 stopRetryMetricsTimer() 关闭定时器,避免 vitest 进程挂起
 */
import { logger } from '../../logger.js';

/** 单个 schema 的重试统计 */
export interface SchemaRetryStats {
  schemaName: string;
  /** 调用总次数 */
  total: number;
  /** 首次即成功的次数 */
  successFirstTry: number;
  /** 重试 N 次后成功的次数(N >= 1) */
  successAfterRetry: number;
  /** 重试 maxRetries 次仍未通过的次数 */
  failedAfterMaxRetries: number;
  /** 重试率 = (total - successFirstTry) / total,0-1 小数 */
  retryRate: number;
  /** 最近一次更新时间 (ISO string) */
  lastUpdatedAt: string;
}

/** 内存中的原始计数器(不带派生字段) */
interface Counter {
  total: number;
  successFirstTry: number;
  successAfterRetry: number;
  failedAfterMaxRetries: number;
  lastUpdatedAt: string;
}

const counters = new Map<string, Counter>();

/** 可疑 schema 的重试率阈值,初始值,后续根据生产数据微调 */
const STRICT_THRESHOLD = 0.3;

/** 后台定时器句柄 */
let timerHandle: NodeJS.Timeout | null = null;

/** 定时器周期:30 分钟 */
const INTERVAL_MS = 30 * 60 * 1000;

/** 是否已启动定时器 */
function isTimerStarted(): boolean {
  return timerHandle !== null;
}

/**
 * 记录一次 chatJsonWithSchemaRetry 调用的最终结果
 * @param input.schemaName  schema 标识(由调用方显式传入)
 * @param input.attempts    本次调用实际尝试次数(>=1),用于区分首试成功 vs 重试成功
 * @param input.succeeded   最终是否通过校验
 */
export function recordRetryResult(input: {
  schemaName: string;
  attempts: number;
  succeeded: boolean;
}): void {
  const { schemaName, attempts, succeeded } = input;
  const name = schemaName?.trim() || 'unknown';

  const existing = counters.get(name);
  const next: Counter = existing ?? {
    total: 0,
    successFirstTry: 0,
    successAfterRetry: 0,
    failedAfterMaxRetries: 0,
    lastUpdatedAt: new Date().toISOString(),
  };

  next.total += 1;
  next.lastUpdatedAt = new Date().toISOString();
  if (succeeded) {
    if (attempts <= 1) {
      next.successFirstTry += 1;
    } else {
      next.successAfterRetry += 1;
    }
  } else {
    next.failedAfterMaxRetries += 1;
  }

  counters.set(name, next);

  // 首次记录时启动定时器(惰性初始化,避免 import 时副作用)
  if (!isTimerStarted()) {
    startRetryMetricsTimer();
  }
}

/** 派生:计算 retryRate 并输出快照 */
function snapshot(c: Counter, schemaName: string): SchemaRetryStats {
  const retryRate = c.total === 0 ? 0 : (c.total - c.successFirstTry) / c.total;
  return {
    schemaName,
    total: c.total,
    successFirstTry: c.successFirstTry,
    successAfterRetry: c.successAfterRetry,
    failedAfterMaxRetries: c.failedAfterMaxRetries,
    retryRate: Number(retryRate.toFixed(4)),
    lastUpdatedAt: c.lastUpdatedAt,
  };
}

/**
 * 获取所有 schema 的当前快照
 * 按 retryRate desc 排序,便于一眼定位异常 schema
 */
export function getAllMetrics(): SchemaRetryStats[] {
  return Array.from(counters.entries())
    .map(([name, c]) => snapshot(c, name))
    .sort((a, b) => b.retryRate - a.retryRate);
}

/**
 * 获取重试率异常的 schema(retryRate > STRICT_THRESHOLD)
 * 仅在最近一次后台定时器输出时被调用,但也暴露出来便于测试与按需查询
 */
export function getStrictSchemaWarnings(): SchemaRetryStats[] {
  return getAllMetrics().filter((s) => s.retryRate > STRICT_THRESHOLD);
}

/**
 * 清空计数器
 * @param schemaName  指定时只清空一个 schema;不传则清空全部
 */
export function resetMetrics(schemaName?: string): void {
  if (schemaName === undefined) {
    counters.clear();
    return;
  }
  counters.delete(schemaName);
}

/** 启动后台定时器(每 30 分钟扫一次,有可疑 schema 就 warn) */
function startRetryMetricsTimer(): void {
  timerHandle = setInterval(() => {
    const warnings = getStrictSchemaWarnings();
    if (warnings.length === 0) return;
    logger.warn(
      {
        warnings: warnings.map((w) => ({
          schema: w.schemaName,
          retryRate: w.retryRate,
          total: w.total,
          failedAfterMaxRetries: w.failedAfterMaxRetries,
        })),
        threshold: STRICT_THRESHOLD,
      },
      '检测到重试率异常的 schema,可能 schema 过严或 prompt 描述不清'
    );
  }, INTERVAL_MS);
  // 不阻止进程退出(参考 Node 文档:unref 让定时器不持有事件循环)
  timerHandle.unref?.();
}

/**
 * 停止后台定时器
 * 主要用于测试关闭 vitest 进程,也可在进程优雅退出钩子里调用
 * 幂等,重复调用安全
 */
export function stopRetryMetricsTimer(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

/** 仅供测试使用:检查定时器是否在运行 */
export function _isRetryMetricsTimerActive(): boolean {
  return isTimerStarted();
}
