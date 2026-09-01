/**
 * 通用调度注册表(v1.6)
 *
 * 目标:
 *   把 cacheScheduler 的"单文件"实现抽象为可复用的注册中心,
 *   未来任何后台任务(统计聚合、报告归档、缓存预热、邮件队列等)
 *   均可一行 register + startAll 即可上线,无需重复 setInterval 模板。
 *
 * 与原 cacheScheduler 的语义兼容:
 *   - setTimeout 首跑 -> runOnce -> setInterval 周期 链式衔接
 *   - 两个 timer 都 unref(),不阻塞进程退出
 *   - 重复 start 幂等
 *   - stop() 用于 SIGTERM 优雅关闭 / 测试清理
 *
 * 异常隔离:
 *   单个 job 的 run() 抛错会被捕获写入 lastError,但不影响其他 job。
 *
 * 周期/首次延迟采用函数形式(getIntervalMs / getFirstDelayMs),
 * 每次 start 时重新求值,以支持 INSIGHTFORGE_LLM_CACHE_CLEANUP_INTERVAL_HOURS
 * 这类环境变量在进程内变更后下一次启动即生效。
 *
 * 用法示例:
 *   register({
 *     name: 'llm-cache-cleanup',
 *     getIntervalMs: () => readIntervalHoursFromEnv() * 3600_000,
 *     getFirstDelayMs: () => readFirstDelaySecFromEnv() * 1000,
 *     run: async () => clearExpired(),
 *   });
 *   startAllSchedulers();
 */
import { logger } from '../../logger.js';

/**
 * 单次 run 的返回值约定:
 *   - 返回数字: 视为「本次清理/处理条数」,记入 status.lastRemoved
 *   - 返回 void: 不写 lastRemoved(适用于聚合计算、推送等无 count 概念的任务)
 *
 * 注: 不抛错即视为成功;异常被外层捕获写入 lastError。
 */
export type ScheduledJobRun = () => Promise<number | void>;

/** 注册一个调度任务所需的最小配置 */
export interface ScheduledJobSpec {
  /** 全局唯一,用于状态查询与日志 */
  name: string;
  /** 周期(毫秒),延迟求值,便于读取运行时 env */
  getIntervalMs: () => number;
  /** 首次延迟(毫秒),延迟求值 */
  getFirstDelayMs: () => number;
  /** 单次执行;返回值可选(number 视为 removed) */
  run: ScheduledJobRun;
}

/** 对外暴露的 job 状态(供 /admin/scheduler/status 等接口) */
export interface JobStatus {
  name: string;
  running: boolean;
  intervalMs: number;
  firstDelayMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  /** 仅在 run() 返回数字时有值,其他任务恒为 null */
  lastRemoved: number | null;
  lastError: string | null;
  nextRunAt: string | null;
}

/** 内部 state:持有 timer 句柄与历史结果 */
interface JobInternalState {
  intervalHandle: NodeJS.Timeout | null;
  timeoutHandle: NodeJS.Timeout | null;
  /** 当前生效的周期;start 时由 getIntervalMs() 写入 */
  intervalMs: number;
  /** 当前生效的首次延迟;start 时由 getFirstDelayMs() 写入 */
  firstDelayMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastRemoved: number | null;
  lastError: string | null;
  nextRunAt: string | null;
}

class SchedulerRegistryImpl {
  private readonly specs = new Map<string, ScheduledJobSpec>();
  private readonly states = new Map<string, JobInternalState>();
  private started = false;

  /** 注册一个调度任务;重复注册同名 job 抛错(便于发现配置错误) */
  register(spec: ScheduledJobSpec): void {
    if (this.specs.has(spec.name)) {
      throw new Error(`调度任务 '${spec.name}' 已注册,不可重复`);
    }
    // 立刻验证一次 getIntervalMs/getFirstDelayMs(防止 start 时才报错)
    const intervalMs = spec.getIntervalMs();
    const firstDelayMs = spec.getFirstDelayMs();
    if (!(intervalMs > 0)) {
      throw new Error(`调度任务 '${spec.name}' getIntervalMs() 必须 > 0,实际 ${intervalMs}`);
    }
    if (firstDelayMs < 0) {
      throw new Error(`调度任务 '${spec.name}' getFirstDelayMs() 必须 >= 0,实际 ${firstDelayMs}`);
    }
    this.specs.set(spec.name, spec);
    this.states.set(spec.name, this.emptyState(intervalMs, firstDelayMs));
    logger.debug(
      { name: spec.name, intervalMs, firstDelayMs },
      '调度任务已注册'
    );
  }

  /** 注销一个 job(同时停止其 timer);便于测试清理与「先注销再以新配置重新注册」 */
  unregister(name: string): boolean {
    if (!this.specs.has(name)) return false;
    this.stopJob(name);
    this.specs.delete(name);
    this.states.delete(name);
    return true;
  }

  /** 判断是否已注册 */
  has(name: string): boolean {
    return this.specs.has(name);
  }

  /** 启动所有已注册 job;幂等:对已在跑的 job no-op */
  startAll(): void {
    if (this.started) {
      logger.debug('调度注册表已启动,跳过重复 startAll');
      return;
    }
    this.started = true;
    for (const name of this.specs.keys()) {
      this.startJob(name);
    }
  }

  /** 启动单个 job(便于按需启动或测试);幂等 */
  start(name: string): void {
    if (!this.specs.has(name)) {
      throw new Error(`调度任务 '${name}' 未注册`);
    }
    this.startJob(name);
    // 一旦单独 start 过某个 job,标记 started 以便后续 startAll 不再重置
    this.started = true;
  }

  /** 停止所有 job */
  stopAll(): void {
    for (const name of this.specs.keys()) {
      this.stopJob(name);
    }
    this.started = false;
    logger.debug('调度注册表已全部停止');
  }

  /** 停止单个 job;幂等 */
  stop(name: string): void {
    this.stopJob(name);
  }

  /** 查询单个 job 状态;未注册返回 null */
  getStatus(name: string): JobStatus | null {
    const state = this.states.get(name);
    if (!state) return null;
    return this.toStatus(name, state);
  }

  /** 列出所有 job 状态,按注册顺序 */
  listStatus(): JobStatus[] {
    const result: JobStatus[] = [];
    for (const [name, state] of this.states.entries()) {
      result.push(this.toStatus(name, state));
    }
    return result;
  }

  /** 已注册的 job 名列表 */
  listNames(): string[] {
    return Array.from(this.specs.keys());
  }

  /** 仅供测试使用:清空全部状态与 timer,保证测试隔离 */
  _resetForTest(): void {
    this.stopAll();
    this.specs.clear();
    this.states.clear();
    this.started = false;
  }

  // ---------- 私有 ----------

  private emptyState(intervalMs: number, firstDelayMs: number): JobInternalState {
    return {
      intervalHandle: null,
      timeoutHandle: null,
      intervalMs,
      firstDelayMs,
      lastRunAt: null,
      lastDurationMs: null,
      lastRemoved: null,
      lastError: null,
      nextRunAt: null,
    };
  }

  private toStatus(name: string, state: JobInternalState): JobStatus {
    return {
      name,
      running: state.intervalHandle !== null || state.timeoutHandle !== null,
      intervalMs: state.intervalMs,
      firstDelayMs: state.firstDelayMs,
      lastRunAt: state.lastRunAt,
      lastDurationMs: state.lastDurationMs,
      lastRemoved: state.lastRemoved,
      lastError: state.lastError,
      nextRunAt: state.nextRunAt,
    };
  }

  private startJob(name: string): void {
    const spec = this.specs.get(name);
    const state = this.states.get(name);
    if (!spec || !state) return;
    if (state.intervalHandle !== null || state.timeoutHandle !== null) {
      logger.debug({ name }, '调度任务已在运行,跳过重复启动');
      return;
    }
    // 每次 start 重新读取 env,允许运行时调整后下次启动生效
    const intervalMs = spec.getIntervalMs();
    const firstDelayMs = spec.getFirstDelayMs();
    if (!(intervalMs > 0) || firstDelayMs < 0) {
      logger.warn(
        { name, intervalMs, firstDelayMs },
        '调度任务配置非法,跳过本次启动'
      );
      return;
    }
    const fresh = this.emptyState(intervalMs, firstDelayMs);
    this.states.set(name, fresh);

    fresh.timeoutHandle = setTimeout(() => {
      fresh.timeoutHandle = null;
      void this.runOnce(name);
      fresh.intervalHandle = setInterval(() => {
        void this.runOnce(name);
      }, fresh.intervalMs);
      fresh.intervalHandle?.unref?.();
    }, fresh.firstDelayMs);
    fresh.timeoutHandle.unref?.();

    logger.info(
      { name, intervalMs: fresh.intervalMs, firstDelayMs: fresh.firstDelayMs },
      '调度任务已启动'
    );
  }

  private stopJob(name: string): void {
    const state = this.states.get(name);
    if (!state) return;
    if (state.timeoutHandle !== null) {
      clearTimeout(state.timeoutHandle);
      state.timeoutHandle = null;
    }
    if (state.intervalHandle !== null) {
      clearInterval(state.intervalHandle);
      state.intervalHandle = null;
    }
    logger.debug({ name }, '调度任务已停止');
  }

  private async runOnce(name: string): Promise<void> {
    const spec = this.specs.get(name);
    const state = this.states.get(name);
    if (!spec || !state) return;
    const startedAt = Date.now();
    let removed: number | null = null;
    let error: string | null = null;
    try {
      const result = await spec.run();
      if (typeof result === 'number') removed = result;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.warn({ name, err: error }, '调度任务执行异常');
    }
    const finishedAt = Date.now();
    state.lastRunAt = new Date(finishedAt).toISOString();
    state.lastRemoved = removed;
    state.lastError = error;
    state.lastDurationMs = finishedAt - startedAt;
    state.nextRunAt = new Date(finishedAt + state.intervalMs).toISOString();
    logger.info(
      {
        name,
        removed,
        durationMs: state.lastDurationMs,
        nextRunAt: state.nextRunAt,
        error,
      },
      '调度任务执行完成'
    );
  }
}

/** 全局单例 */
export const schedulerRegistry = new SchedulerRegistryImpl();
