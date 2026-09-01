/**
 * 调度注册表统一入口(v1.6)
 *
 * 暴露:
 *   - registerJob(spec): 让其他模块(cron / 业务)一行注册后台任务
 *   - startAllSchedulers() / stopAllSchedulers(): 进程生命周期钩子
 *   - getSchedulersStatus(): 给 /admin/scheduler/status 暴露状态
 *
 * 设计要点:
 *   - 每个内置任务的注册逻辑独立写在对应业务模块(如 llm/cacheScheduler.ts),
 *     由 ensureBuiltinSchedulersRegistered() 统一触发;
 *     index.ts 只需 import startAllSchedulers 一次即可
 *   - 新增后台任务只需: 1) 在业务模块暴露 ensureXxxRegistered() 函数;
 *                     2) 在 ensureBuiltinSchedulersRegistered() 里调用一次
 */
import { logger } from '../../logger.js';
import {
  schedulerRegistry,
  type JobStatus,
  type ScheduledJobSpec,
} from './registry.js';
import { ensureCacheCleanupRegistered } from '../llm/cacheScheduler.js';

export type { JobStatus, ScheduledJobSpec } from './registry.js';

/** 注册一个调度任务(供其他模块使用);重复注册同名 job 抛错 */
export function registerJob(spec: ScheduledJobSpec): void {
  schedulerRegistry.register(spec);
}

/** 注销一个调度任务(同时停止其 timer) */
export function unregisterJob(name: string): boolean {
  return schedulerRegistry.unregister(name);
}

/** 启动所有已注册 job(幂等);内部自动触发内置任务注册 */
export function startAllSchedulers(): void {
  ensureBuiltinSchedulersRegistered();
  schedulerRegistry.startAll();
}

/** 停止所有 job(幂等) */
export function stopAllSchedulers(): void {
  schedulerRegistry.stopAll();
}

/** 查询所有 job 状态 */
export function getSchedulersStatus(): JobStatus[] {
  return schedulerRegistry.listStatus();
}

/** 查询单个 job 状态(供其他模块在自身接口中桥接,如 /admin/llm-cache/scheduler) */
export function getSchedulerStatus(name: string): JobStatus | null {
  return schedulerRegistry.getStatus(name);
}

/** 判断某个 job 是否已注册 */
export function hasScheduler(name: string): boolean {
  return schedulerRegistry.has(name);
}

/**
 * 注册内置的核心后台任务
 *
 * 每个内置任务模块都暴露 ensureXxxRegistered() 幂等函数;
 * 调用顺序无关,所有任务都会被注册到 registry(只一次)。
 */
function ensureBuiltinSchedulersRegistered(): void {
  ensureCacheCleanupRegistered();
  logger.debug('内置调度任务已注册');
}
