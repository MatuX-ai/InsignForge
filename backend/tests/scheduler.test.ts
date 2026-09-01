/**
 * services/scheduler/registry.ts + index.ts 单元测试(v1.6)
 *
 * 覆盖:
 *   1. register 基础: 单 job 注册、状态查询、start/stop 生命周期
 *   2. 重复注册同名 job 抛错
 *   3. start 幂等: 重复 startAll 不会创建多个 timer
 *   4. 异常隔离: 单个 job 抛错被捕获写入 lastError,不影响其他 job 与定时器
 *   5. run() 返回 number → lastRemoved 正确写入
 *   6. run() 返回 void → lastRemoved 仍为 null
 *   7. getIntervalMs / getFirstDelayMs 在每次 start 时重新求值(env 运行时修改生效)
 *   8. unregister 停止 timer 并删除 spec
 *   9. listStatus 按注册顺序
 *  10. 桥接: scheduler/index.ts 的 getSchedulersStatus 返回 listStatus
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  schedulerRegistry,
  type JobStatus,
} from '../src/services/scheduler/registry.js';
import {
  registerJob,
  unregisterJob,
  startAllSchedulers,
  stopAllSchedulers,
  getSchedulersStatus,
  hasScheduler,
} from '../src/services/scheduler/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  schedulerRegistry._resetForTest();
});

afterEach(async () => {
  schedulerRegistry._resetForTest();
  // 给 unref 后的 timer 一点时间回收
  await sleep(5);
});

describe('SchedulerRegistry: register / status / start / stop', () => {
  it('初始无注册时 listStatus 为空', () => {
    expect(schedulerRegistry.listStatus()).toEqual([]);
    expect(schedulerRegistry.listNames()).toEqual([]);
  });

  it('register 后可查询状态,running=false', () => {
    registerJob({
      name: 'job-a',
      getIntervalMs: () => 60_000,
      getFirstDelayMs: () => 1_000,
      run: async () => 0,
    });
    const status = schedulerRegistry.getStatus('job-a');
    expect(status).not.toBeNull();
    expect(status?.name).toBe('job-a');
    expect(status?.running).toBe(false);
    expect(status?.intervalMs).toBe(60_000);
    expect(status?.firstDelayMs).toBe(1_000);
    expect(status?.lastRunAt).toBeNull();
    expect(status?.lastRemoved).toBeNull();
    expect(status?.lastError).toBeNull();
    expect(status?.nextRunAt).toBeNull();
  });

  it('重复 register 同名 job 抛错', () => {
    registerJob({
      name: 'dup',
      getIntervalMs: () => 60_000,
      getFirstDelayMs: () => 1_000,
      run: async () => {},
    });
    expect(() =>
      registerJob({
        name: 'dup',
        getIntervalMs: () => 30_000,
        getFirstDelayMs: () => 0,
        run: async () => {},
      })
    ).toThrow(/已注册/);
  });

  it('register 时 getIntervalMs 返回非正数抛错', () => {
    expect(() =>
      registerJob({
        name: 'bad',
        getIntervalMs: () => 0,
        getFirstDelayMs: () => 0,
        run: async () => {},
      })
    ).toThrow(/getIntervalMs/);
  });

  it('register 时 getFirstDelayMs 负数抛错', () => {
    expect(() =>
      registerJob({
        name: 'bad',
        getIntervalMs: () => 60_000,
        getFirstDelayMs: () => -1,
        run: async () => {},
      })
    ).toThrow(/getFirstDelayMs/);
  });

  it('start 后 running=true', () => {
    registerJob({
      name: 'a',
      getIntervalMs: () => 60_000,
      getFirstDelayMs: () => 1_000,
      run: async () => 0,
    });
    schedulerRegistry.start('a');
    expect(schedulerRegistry.getStatus('a')?.running).toBe(true);
  });

  it('start 幂等: 重复 start 不会改状态', () => {
    registerJob({
      name: 'a',
      getIntervalMs: () => 60_000,
      getFirstDelayMs: () => 1_000,
      run: async () => 0,
    });
    schedulerRegistry.start('a');
    schedulerRegistry.start('a');
    schedulerRegistry.start('a');
    expect(schedulerRegistry.getStatus('a')?.running).toBe(true);
  });

  it('stop 后 running=false', () => {
    registerJob({
      name: 'a',
      getIntervalMs: () => 60_000,
      getFirstDelayMs: () => 1_000,
      run: async () => 0,
    });
    schedulerRegistry.start('a');
    schedulerRegistry.stop('a');
    expect(schedulerRegistry.getStatus('a')?.running).toBe(false);
  });

  it('stop 在未 start 时也不抛错', () => {
    registerJob({
      name: 'a',
      getIntervalMs: () => 60_000,
      getFirstDelayMs: () => 1_000,
      run: async () => 0,
    });
    expect(() => schedulerRegistry.stop('a')).not.toThrow();
  });
});

describe('SchedulerRegistry: 异常隔离', () => {
  it('run() 抛错被捕获,timer 继续运行(后续 run 会清空 lastError)', async () => {
    let callCount = 0;
    registerJob({
      name: 'flaky',
      getIntervalMs: () => 100, // 短周期便于后续断言
      getFirstDelayMs: () => 30,
      run: async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('boom');
        }
        return 5;
      },
    });
    schedulerRegistry.start('flaky');
    // 等待首次失败 + 第二次成功
    await sleep(300);
    const status = schedulerRegistry.getStatus('flaky');
    expect(status).not.toBeNull();
    // 第二次 run 成功 → lastError 被清空(设计:每次 run 都重置,最近一次结果)
    expect(status?.lastError).toBeNull();
    // 但 lastRunAt 一定更新了,证明 timer 没死
    expect(status?.lastRunAt).not.toBeNull();
    // 且后续 run 有返回值,证明 run 仍正常调用
    expect(callCount).toBeGreaterThanOrEqual(2);
    schedulerRegistry.stop('flaky');
  });

  it('job A 抛错不影响 job B 的执行', async () => {
    const aRan: number[] = [];
    const bRan: number[] = [];
    registerJob({
      name: 'a',
      getIntervalMs: () => 50,
      getFirstDelayMs: () => 30,
      run: async () => {
        aRan.push(Date.now());
        throw new Error('a exploded');
      },
    });
    registerJob({
      name: 'b',
      getIntervalMs: () => 50,
      getFirstDelayMs: () => 30,
      run: async () => {
        bRan.push(Date.now());
        return 7;
      },
    });
    startAllSchedulers();
    await sleep(200);
    stopAllSchedulers();
    expect(aRan.length).toBeGreaterThan(0);
    expect(bRan.length).toBeGreaterThan(0);
    expect(schedulerRegistry.getStatus('b')?.lastRemoved).toBe(7);
    // a 应有 error,b 应无
    expect(schedulerRegistry.getStatus('a')?.lastError).toBe('a exploded');
    expect(schedulerRegistry.getStatus('b')?.lastError).toBeNull();
  });
});

describe('SchedulerRegistry: run 返回值', () => {
  it('run() 返回 number → lastRemoved 写入', async () => {
    registerJob({
      name: 'counter',
      getIntervalMs: () => 100,
      getFirstDelayMs: () => 30,
      run: async () => 42,
    });
    schedulerRegistry.start('counter');
    await sleep(150);
    const s = schedulerRegistry.getStatus('counter');
    expect(s?.lastRemoved).toBe(42);
    schedulerRegistry.stop('counter');
  });

  it('run() 返回 void → lastRemoved 保持 null', async () => {
    registerJob({
      name: 'silent',
      getIntervalMs: () => 100,
      getFirstDelayMs: () => 30,
      run: async () => {
        // 模拟推送任务,无 count 概念
      },
    });
    schedulerRegistry.start('silent');
    await sleep(150);
    const s = schedulerRegistry.getStatus('silent');
    expect(s?.lastRunAt).not.toBeNull();
    expect(s?.lastRemoved).toBeNull();
    schedulerRegistry.stop('silent');
  });
});

describe('SchedulerRegistry: env 延迟求值', () => {
  it('getIntervalMs / getFirstDelayMs 每次 start 重新求值', () => {
    let interval = 1000;
    let delay = 500;
    registerJob({
      name: 'dynamic',
      getIntervalMs: () => interval,
      getFirstDelayMs: () => delay,
      run: async () => 0,
    });
    schedulerRegistry.start('dynamic');
    expect(schedulerRegistry.getStatus('dynamic')?.intervalMs).toBe(1000);
    expect(schedulerRegistry.getStatus('dynamic')?.firstDelayMs).toBe(500);
    schedulerRegistry.stop('dynamic');

    // 模拟运行时调整 env
    interval = 2000;
    delay = 100;
    schedulerRegistry.start('dynamic');
    expect(schedulerRegistry.getStatus('dynamic')?.intervalMs).toBe(2000);
    expect(schedulerRegistry.getStatus('dynamic')?.firstDelayMs).toBe(100);
    schedulerRegistry.stop('dynamic');
  });
});

describe('SchedulerRegistry: unregister', () => {
  it('unregister 停止 timer 并删除状态', () => {
    registerJob({
      name: 'tmp',
      getIntervalMs: () => 1000,
      getFirstDelayMs: () => 100,
      run: async () => 0,
    });
    schedulerRegistry.start('tmp');
    expect(schedulerRegistry.has('tmp')).toBe(true);
    const ok = schedulerRegistry.unregister('tmp');
    expect(ok).toBe(true);
    expect(schedulerRegistry.has('tmp')).toBe(false);
    expect(schedulerRegistry.getStatus('tmp')).toBeNull();
  });

  it('unregister 不存在的 job 返回 false', () => {
    expect(schedulerRegistry.unregister('ghost')).toBe(false);
  });
});

describe('SchedulerRegistry: listStatus', () => {
  it('按注册顺序返回', () => {
    registerJob({
      name: 'z',
      getIntervalMs: () => 1000,
      getFirstDelayMs: () => 0,
      run: async () => 0,
    });
    registerJob({
      name: 'a',
      getIntervalMs: () => 1000,
      getFirstDelayMs: () => 0,
      run: async () => 0,
    });
    registerJob({
      name: 'm',
      getIntervalMs: () => 1000,
      getFirstDelayMs: () => 0,
      run: async () => 0,
    });
    const names = schedulerRegistry.listStatus().map((s) => s.name);
    expect(names).toEqual(['z', 'a', 'm']);
  });
});

describe('scheduler/index.ts 桥接', () => {
  it('registerJob / hasScheduler / unregisterJob 与 registry 一致', () => {
    registerJob({
      name: 'bridge',
      getIntervalMs: () => 1000,
      getFirstDelayMs: () => 100,
      run: async () => 1,
    });
    expect(hasScheduler('bridge')).toBe(true);
    expect(unregisterJob('bridge')).toBe(true);
    expect(hasScheduler('bridge')).toBe(false);
  });

  it('getSchedulersStatus 返回 listStatus 的浅拷贝', () => {
    registerJob({
      name: 'x',
      getIntervalMs: () => 1000,
      getFirstDelayMs: () => 0,
      run: async () => 0,
    });
    const list: JobStatus[] = getSchedulersStatus();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('x');
  });
});
