/**
 * 信号量(Semaphore) - 控制最大并发调研任务数(NFR-06)
 *
 * 设计要点:
 * 1. 基于 Promise 队列的"公平"FIFO 实现
 * 2. release 必须与 acquire 配对;即使任务异常也通过 try/finally 释放
 * 3. 容量 ≤ 0 时退化为 unlimited(便于测试)
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(capacity: number) {
    this.available = Math.max(0, capacity | 0);
  }

  /** 获取一个令牌;无可用时挂起 */
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** 释放一个令牌;唤醒最早等待者 */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      // 注意:不增加 available,因为已转移给等待者
    } else {
      this.available++;
    }
  }

  /** 包装异步任务,自动 acquire/release(NFR-06 友好写法) */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  get pending(): number {
    return this.waiters.length;
  }

  get capacity(): number {
    return this.available + this.waiters.length;
  }
}
