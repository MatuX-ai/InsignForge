/**
 * 单元测试 —— Semaphore(并发控制)
 *
 * 覆盖 NFR-06:公平 FIFO、最大并发上限、run() 自动 acquire/release。
 */
import { describe, it, expect } from 'vitest';
import { Semaphore } from '../src/concurrency.js';

describe('Semaphore - 基础语义', () => {
  it('capacity 为正时,available 等于初始容量', () => {
    const s = new Semaphore(3);
    expect(s.capacity).toBe(3);
    expect(s.pending).toBe(0);
  });

  it('capacity 为 0 时 acquire 会挂起(需后续 release 才能继续)', async () => {
    const s = new Semaphore(0);
    let resolved = false;
    const p = s.acquire().then(() => {
      resolved = true;
    });
    // 等待若干微任务,确认尚未 resolve
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    // 手动 release 唤醒等待者
    s.release();
    await p;
    expect(resolved).toBe(true);
  });

  it('capacity 为负也被规范化为 0', () => {
    const s = new Semaphore(-5);
    expect(s.capacity).toBe(0);
  });
});

describe('Semaphore - 并发上限', () => {
  it('超过 capacity 时,多余任务进入 wait 队列', async () => {
    const s = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      s.run(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return i;
      })
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('FIFO 顺序:先等待者先被唤醒', async () => {
    const s = new Semaphore(1);
    const order: number[] = [];

    const t1 = s.run(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
    });
    const t2 = s.run(async () => {
      order.push(2);
    });
    const t3 = s.run(async () => {
      order.push(3);
    });

    await Promise.all([t1, t2, t3]);
    // 入口顺序是 1 → 2 → 3,FIFO 应保留该顺序
    expect(order).toEqual([1, 2, 3]);
  });

  it('即使任务抛错,release 仍能释放', async () => {
    const s = new Semaphore(1);
    await expect(
      s.run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // capacity 恢复到 1
    expect(s.capacity).toBe(1);
    expect(s.pending).toBe(0);

    // 后续任务可正常执行
    const r = await s.run(async () => 42);
    expect(r).toBe(42);
  });

  it('run() 透传 task 的返回值', async () => {
    const s = new Semaphore(2);
    const r = await s.run(async () => ({ ok: true }));
    expect(r).toEqual({ ok: true });
  });
});

describe('Semaphore - pending 计数', () => {
  it('等待中任务数反映在 pending', async () => {
    const s = new Semaphore(1);
    const tasks: Array<Promise<void>> = [];
    // 第 1 个立即执行
    tasks.push(
      s.run(async () => {
        await new Promise((r) => setTimeout(r, 30));
      })
    );
    // 第 2、3 个进入队列
    tasks.push(
      s.run(async () => {
        await new Promise((r) => setTimeout(r, 30));
      })
    );
    tasks.push(
      s.run(async () => {
        await new Promise((r) => setTimeout(r, 30));
      })
    );

    // 微任务稍作等待,确保 waiters 已入队
    await Promise.resolve();
    expect(s.pending).toBe(2);

    await Promise.all(tasks);
    expect(s.pending).toBe(0);
  });
});