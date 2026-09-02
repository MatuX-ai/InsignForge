/**
 * ExecutionService.s 实时指标(数据瀑布)单测
 *
 * 覆盖 vNext 新增的不变量:
 *   1. addMetricSamples 按 source 合并 buckets.count
 *   2. addMetricSamples samples 按 crawled_at 倒序保留最近 MAX_SAMPLES 条
 *   3. buckets 按 count 降序排列
 *   4. 空 samples 不抛错、不变更已有 metrics
 *   5. getMetrics 在 add 之前为 undefined,clearMetrics 后再变 undefined
 *   6. executionId 维度隔离:id1 的 metrics 不影响 id2
 *   7. addMetricSamples 抛错不会让 getById 读 DB 的路径异常
 *      (但 addMetricSamples 内部不调 DB,这里仅回归测试抛错兜底)
 *
 * 设计要点:
 *   - metrics 是纯内存逻辑,不依赖 DB,所以不 mock getDb
 *   - getById / getLatestByProject 也走 DB,但本测试不调它们(走 getMetrics 即可)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ExecutionService } from '../src/services/ExecutionService.js';
import type { ExecutionMetricSample } from '../src/types/index.js';

function mkSample(
  source: string,
  title: string,
  engagement = 0,
  crawledAt = new Date().toISOString()
): ExecutionMetricSample {
  return {
    source,
    title,
    url: null,
    engagement,
    crawled_at: crawledAt,
  };
}

beforeEach(() => {
  // 清理每个测试可能留下的 metrics,避免跨测试污染
  // metricsCache 是模块私有,用 clearMetrics 兜底(不直接访问 Map)
  // 这里我们假设每个测试用全新的 executionId,实际也确实如此
});

describe('ExecutionService.addMetricSamples - buckets 合并', () => {
  it('单批样本:每个 source 落一个 bucket,count = 该 source 的样本数', () => {
    const id = 'exec-bucket-1';
    ExecutionService.clearMetrics(id);

    ExecutionService.addMetricSamples(id, [
      mkSample('reddit', 'r1'),
      mkSample('reddit', 'r2'),
      mkSample('hackernews', 'h1'),
      mkSample('google', 'g1'),
    ]);

    const m = ExecutionService.getMetrics(id);
    expect(m).toBeDefined();
    expect(m!.buckets).toHaveLength(3);
    const bySource = Object.fromEntries(m!.buckets.map((b) => [b.source, b.count]));
    expect(bySource.reddit).toBe(2);
    expect(bySource.hackernews).toBe(1);
    expect(bySource.google).toBe(1);
  });

  it('多批样本:同 source 累加,新 source 追加', () => {
    const id = 'exec-bucket-2';
    ExecutionService.clearMetrics(id);

    ExecutionService.addMetricSamples(id, [
      mkSample('reddit', 'r1'),
      mkSample('reddit', 'r2'),
      mkSample('hackernews', 'h1'),
    ]);
    ExecutionService.addMetricSamples(id, [
      mkSample('reddit', 'r3'),
      mkSample('google', 'g1'),
      mkSample('google', 'g2'),
    ]);

    const m = ExecutionService.getMetrics(id)!;
    const bySource = Object.fromEntries(m.buckets.map((b) => [b.source, b.count]));
    expect(bySource.reddit).toBe(3);
    expect(bySource.hackernews).toBe(1);
    expect(bySource.google).toBe(2);
  });

  it('buckets 按 count 降序排列', () => {
    const id = 'exec-bucket-3';
    ExecutionService.clearMetrics(id);

    ExecutionService.addMetricSamples(id, [
      mkSample('google', 'g1'),
      mkSample('reddit', 'r1'),
      mkSample('reddit', 'r2'),
      mkSample('reddit', 'r3'),
      mkSample('hackernews', 'h1'),
      mkSample('hackernews', 'h2'),
    ]);

    const m = ExecutionService.getMetrics(id)!;
    // google=1 < hackernews=2 < reddit=3 → 应降序
    expect(m.buckets.map((b) => b.source)).toEqual(['reddit', 'hackernews', 'google']);
  });

  it('空 samples 不变更 metrics', () => {
    const id = 'exec-bucket-4';
    ExecutionService.clearMetrics(id);

    ExecutionService.addMetricSamples(id, [mkSample('reddit', 'r1')]);
    const before = ExecutionService.getMetrics(id);

    ExecutionService.addMetricSamples(id, []);
    const after = ExecutionService.getMetrics(id);

    expect(after).toBe(before);
    expect(after!.buckets).toHaveLength(1);
    expect(after!.samples).toHaveLength(1);
  });
});

describe('ExecutionService.addMetricSamples - samples 截断与排序', () => {
  it('新批次整体插入队首,按 crawled_at 倒序', () => {
    const id = 'exec-sort-1';
    ExecutionService.clearMetrics(id);

    // 第一批:旧样本
    ExecutionService.addMetricSamples(id, [
      mkSample('reddit', 'old1', 1, '2026-01-01T00:00:00.000Z'),
      mkSample('reddit', 'old2', 2, '2026-01-01T00:00:01.000Z'),
    ]);
    // 第二批:新样本(更新 crawled_at)
    ExecutionService.addMetricSamples(id, [
      mkSample('reddit', 'new1', 3, '2026-02-01T00:00:00.000Z'),
      mkSample('reddit', 'new2', 4, '2026-02-01T00:00:01.000Z'),
    ]);

    const m = ExecutionService.getMetrics(id)!;
    expect(m.samples.map((s) => s.title)).toEqual(['new2', 'new1', 'old2', 'old1']);
  });

  it('超过 MAX_SAMPLES (30) 时只保留最新 30 条', () => {
    const id = 'exec-trunc-1';
    ExecutionService.clearMetrics(id);

    // 构造 35 条,crawled_at 用 idx 保证严格升序
    const samples: ExecutionMetricSample[] = Array.from({ length: 35 }, (_, i) => ({
      source: 'reddit',
      title: `item-${i}`,
      url: null,
      engagement: i,
      crawled_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }));

    ExecutionService.addMetricSamples(id, samples);

    const m = ExecutionService.getMetrics(id)!;
    expect(m.samples).toHaveLength(30);
    // 倒序后第 0 条应该是 idx=34(最新的)
    expect(m.samples[0]!.title).toBe('item-34');
    // 第 29 条应该是 idx=5
    expect(m.samples[29]!.title).toBe('item-5');
  });
});

describe('ExecutionService metrics - 生命周期', () => {
  it('addMetricSamples 之前 getMetrics 返回 undefined', () => {
    const id = 'exec-life-1';
    ExecutionService.clearMetrics(id);
    expect(ExecutionService.getMetrics(id)).toBeUndefined();
  });

  it('clearMetrics 后 getMetrics 回到 undefined', () => {
    const id = 'exec-life-2';
    ExecutionService.clearMetrics(id);
    ExecutionService.addMetricSamples(id, [mkSample('reddit', 'r1')]);
    expect(ExecutionService.getMetrics(id)).toBeDefined();

    ExecutionService.clearMetrics(id);
    expect(ExecutionService.getMetrics(id)).toBeUndefined();
  });

  it('不同 executionId 之间互不影响', () => {
    const idA = 'exec-iso-a';
    const idB = 'exec-iso-b';
    ExecutionService.clearMetrics(idA);
    ExecutionService.clearMetrics(idB);

    ExecutionService.addMetricSamples(idA, [mkSample('reddit', 'a1')]);
    ExecutionService.addMetricSamples(idB, [
      mkSample('reddit', 'b1'),
      mkSample('hackernews', 'b2'),
    ]);

    const a = ExecutionService.getMetrics(idA)!;
    const b = ExecutionService.getMetrics(idB)!;
    expect(a.buckets).toHaveLength(1);
    expect(b.buckets).toHaveLength(2);
    expect(a.samples[0]!.title).toBe('a1');
    expect(b.samples.map((s) => s.title)).toEqual(['b2', 'b1']);

    // 清 A 不应影响 B
    ExecutionService.clearMetrics(idA);
    expect(ExecutionService.getMetrics(idA)).toBeUndefined();
    expect(ExecutionService.getMetrics(idB)).toBeDefined();
  });

  it('addMetricSamples 内部对单条样本字段缺失的容忍(传入空 title/url/engagement)', () => {
    // 防御性:即 upstream 给出奇怪数据,metrics 也不崩
    const id = 'exec-life-3';
    ExecutionService.clearMetrics(id);

    ExecutionService.addMetricSamples(id, [
      { source: 'unknown-source', title: '', url: null, engagement: 0, crawled_at: '' },
      { source: '', title: 'x', url: null, engagement: -5, crawled_at: '2026-01-01' },
    ]);

    const m = ExecutionService.getMetrics(id)!;
    expect(m.samples).toHaveLength(2);
    expect(m.buckets.map((b) => b.source).sort()).toEqual(['', 'unknown-source']);
  });
});

describe('ExecutionService.addMetricSamples - 异常容忍', () => {
  it('addMetricSamples 不会因为 Array.isArray 之外的入参崩(空数组走短路)', () => {
    const id = 'exec-edge-1';
    ExecutionService.clearMetrics(id);

    // 空数组:内部提前 return,无副作用
    expect(() => ExecutionService.addMetricSamples(id, [])).not.toThrow();
    expect(ExecutionService.getMetrics(id)).toBeUndefined();
  });

  it('addMetricSamples 即便在传入畸形样本时也不抛错给上游', () => {
    const id = 'exec-edge-2';
    ExecutionService.clearMetrics(id);

    // 类型上我们要求 title 是 string,但运行时给个奇怪值也不应让 process 崩
    const bad = { source: 'x', title: undefined as unknown as string, url: null, engagement: 1, crawled_at: 'now' };
    expect(() => ExecutionService.addMetricSamples(id, [bad])).not.toThrow();
    // 不验证内部存储,只看进程没崩
  });
});