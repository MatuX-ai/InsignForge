/**
 * services/llm/retryMetrics.ts 单元测试
 *
 * 覆盖:
 *   1. recordRetryResult 累加计数器正确(首试成功 / 重试成功 / 最终失败)
 *   2. retryRate 计算正确
 *   3. getAllMetrics 按 retryRate desc 排序
 *   4. getStrictSchemaWarnings 仅返回 retryRate > 0.3 的 schema
 *   5. resetMetrics(全部 / 单 schema) 行为
 *   6. schemaName 为空时兜底为 'unknown'
 *   7. stopRetryMetricsTimer 幂等(重复调用不抛错)
 *   8. 后台定时器首次 recordRetryResult 时启动
 *
 * 测试隔离:
 *   - 每个用例 beforeEach 重置 metrics + 关闭定时器,避免状态污染与 vitest 挂起
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 抑制 logger 噪音(并允许用 spy 验证 warn 触发)
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  recordRetryResult,
  getAllMetrics,
  getStrictSchemaWarnings,
  resetMetrics,
  stopRetryMetricsTimer,
  _isRetryMetricsTimerActive,
} from '../src/services/llm/retryMetrics.js';

beforeEach(() => {
  resetMetrics();
  stopRetryMetricsTimer();
});

afterEach(() => {
  stopRetryMetricsTimer();
});

describe('recordRetryResult - 计数器累加', () => {
  it('首次成功 → successFirstTry + 1, retryRate = 0', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    const [a] = getAllMetrics();
    expect(a.total).toBe(1);
    expect(a.successFirstTry).toBe(1);
    expect(a.successAfterRetry).toBe(0);
    expect(a.failedAfterMaxRetries).toBe(0);
    expect(a.retryRate).toBe(0);
  });

  it('多次重试后成功 → successAfterRetry + 1, retryRate > 0', () => {
    recordRetryResult({ schemaName: 'A', attempts: 3, succeeded: true });
    const [a] = getAllMetrics();
    expect(a.successFirstTry).toBe(0);
    expect(a.successAfterRetry).toBe(1);
    expect(a.retryRate).toBe(1); // 重试过即视为非首试成功
  });

  it('最终失败 → failedAfterMaxRetries + 1, retryRate > 0', () => {
    recordRetryResult({ schemaName: 'A', attempts: 3, succeeded: false });
    const [a] = getAllMetrics();
    expect(a.failedAfterMaxRetries).toBe(1);
    expect(a.retryRate).toBe(1);
  });

  it('同一 schema 多次调用累加 total', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 2, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 3, succeeded: false });
    const [a] = getAllMetrics();
    expect(a.total).toBe(4);
    expect(a.successFirstTry).toBe(2);
    expect(a.successAfterRetry).toBe(1);
    expect(a.failedAfterMaxRetries).toBe(1);
    // retryRate = (4 - 2) / 4 = 0.5
    expect(a.retryRate).toBe(0.5);
  });

  it('不同 schema 各自维护计数器', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 3, succeeded: true });
    recordRetryResult({ schemaName: 'B', attempts: 1, succeeded: true });
    const all = getAllMetrics();
    const a = all.find((s) => s.schemaName === 'A');
    const b = all.find((s) => s.schemaName === 'B');
    expect(a?.total).toBe(2);
    expect(a?.retryRate).toBe(0.5);
    expect(b?.total).toBe(1);
    expect(b?.retryRate).toBe(0);
  });

  it('schemaName 为空字符串 → 兜底为 "unknown"', () => {
    recordRetryResult({ schemaName: '   ', attempts: 1, succeeded: true });
    const [a] = getAllMetrics();
    expect(a.schemaName).toBe('unknown');
  });

  it('lastUpdatedAt 在每次 record 后更新', async () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    const first = getAllMetrics()[0]!.lastUpdatedAt;
    // 确保 ISO 时间戳前进 1ms
    await new Promise((r) => setTimeout(r, 5));
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    const second = getAllMetrics()[0]!.lastUpdatedAt;
    expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
  });
});

describe('getAllMetrics - 排序', () => {
  it('按 retryRate desc 排序', () => {
    recordRetryResult({ schemaName: 'low', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'low', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'mid', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'mid', attempts: 2, succeeded: true });
    recordRetryResult({ schemaName: 'high', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'high', attempts: 2, succeeded: true });
    recordRetryResult({ schemaName: 'high', attempts: 3, succeeded: true });

    const names = getAllMetrics().map((s) => s.schemaName);
    expect(names).toEqual(['high', 'mid', 'low']);
  });

  it('空时返回空数组', () => {
    expect(getAllMetrics()).toEqual([]);
  });

  it('retryRate 保留 4 位小数', () => {
    // 3 次成功首试 + 1 次重试成功 = 4 次,retryRate = 0.25
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 2, succeeded: true });
    const [a] = getAllMetrics();
    expect(a.retryRate).toBe(0.25);
  });
});

describe('getStrictSchemaWarnings', () => {
  it('retryRate > 0.3 时被筛出', () => {
    // A: retryRate = 4/4 = 1.0 → 警告
    recordRetryResult({ schemaName: 'A', attempts: 2, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 2, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 2, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 3, succeeded: false });
    // B: retryRate = 0 → 不警告
    recordRetryResult({ schemaName: 'B', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'B', attempts: 1, succeeded: true });

    const warnings = getStrictSchemaWarnings();
    expect(warnings.map((s) => s.schemaName)).toEqual(['A']);
  });

  it('retryRate = 0.3 时不被筛出(严格大于)', () => {
    // 10 次调用 3 次重试过:retryRate = 0.3, 不应进入警告
    for (let i = 0; i < 7; i++) {
      recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    }
    for (let i = 0; i < 3; i++) {
      recordRetryResult({ schemaName: 'A', attempts: 2, succeeded: true });
    }
    expect(getStrictSchemaWarnings()).toEqual([]);
  });

  it('所有 schema retryRate 都 ≤ 0.3 → 返回空数组', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    expect(getStrictSchemaWarnings()).toEqual([]);
  });
});

describe('resetMetrics', () => {
  it('不传参时清空全部', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'B', attempts: 1, succeeded: true });
    resetMetrics();
    expect(getAllMetrics()).toEqual([]);
  });

  it('传 schemaName 时只清空指定一个', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    recordRetryResult({ schemaName: 'B', attempts: 1, succeeded: true });
    resetMetrics('A');
    const all = getAllMetrics();
    expect(all).toHaveLength(1);
    expect(all[0]!.schemaName).toBe('B');
  });

  it('清空不存在的 schema 不抛错', () => {
    expect(() => resetMetrics('nonexistent')).not.toThrow();
  });
});

describe('定时器生命周期', () => {
  it('首次 recordRetryResult 时启动定时器', () => {
    expect(_isRetryMetricsTimerActive()).toBe(false);
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    expect(_isRetryMetricsTimerActive()).toBe(true);
  });

  it('stopRetryMetricsTimer 幂等,重复调用不抛错', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    expect(() => {
      stopRetryMetricsTimer();
      stopRetryMetricsTimer();
      stopRetryMetricsTimer();
    }).not.toThrow();
    expect(_isRetryMetricsTimerActive()).toBe(false);
  });

  it('resetMetrics 不主动关闭定时器(下次 record 不会重复启动)', () => {
    recordRetryResult({ schemaName: 'A', attempts: 1, succeeded: true });
    expect(_isRetryMetricsTimerActive()).toBe(true);
    resetMetrics();
    expect(_isRetryMetricsTimerActive()).toBe(true);
  });
});
