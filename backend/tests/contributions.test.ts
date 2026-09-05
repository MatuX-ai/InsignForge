/**
 * services/search/contributions.ts 单元测试(v1.6 / v1.7+)
 *
 * 覆盖:
 *  v1.6
 *   1. 空 needs 返回 []
 *   2. 单 source: count/weight/percentage 正确(100%)
 *   3. 多 source: 按 percentage 降序
 *   4. 权重生效: 相同 count 不同 weight → percentage 不同
 *   5. 未知 source 走 FALLBACK (weight=1, type=search)
 *   6. 百分比之和接近 100(允许 ±0.2 误差)
 *   7. 环境变量 INSIGHTFORGE_SOURCE_WEIGHTS 可覆盖默认权重
 *  v1.7+(ATTEMPTED_SOURCES 路径)
 *   8. needs=[] + attemptedSources 非空 → 返回 0 命中源列表(诚实表达)
 *   9. needs 有数据 + attemptedSources 含 0 命中源 → 0 命中源 percentage=0 不稀释非零源
 *  10. needs 有数据 + attemptedSources 含 0 命中源 → 百分比之和仍接近 100
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeContributions } from '../src/services/search/contributions.js';
import { _resetSourceWeightsForTest } from '../src/services/search/sourceWeights.js';
import type { MarketNeed } from '../src/types/index.js';

function makeNeed(source: string): MarketNeed {
  return {
    id: 'n',
    content: 'x',
    source: source as MarketNeed['source'],
    url: null,
    author: null,
    title: null,
    category: null,
    sentiment_score: 0,
    engagement: 0,
    tags: null,
    project_id: 'p',
    crawled_at: '',
  };
}

beforeEach(() => {
  _resetSourceWeightsForTest();
  delete process.env.INSIGHTFORGE_SOURCE_WEIGHTS;
});

afterEach(() => {
  _resetSourceWeightsForTest();
  delete process.env.INSIGHTFORGE_SOURCE_WEIGHTS;
});

describe('computeContributions: 基础', () => {
  it('空 needs 返回 []', () => {
    expect(computeContributions([])).toEqual([]);
  });

  it('单 source: count/weight/percentage 正确(100%)', () => {
    const needs = [makeNeed('reddit'), makeNeed('reddit'), makeNeed('reddit')];
    const result = computeContributions(needs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: 'reddit',
      type: 'social',
      count: 3,
      weight: 1.0,
      percentage: 100,
    });
  });
});

describe('computeContributions: 排序与权重', () => {
  it('多 source 按 percentage 降序排列', () => {
    // reddit=3 (weight 1.0 → 3), hackernews=1 (weight 1.2 → 1.2)
    // 总加权 = 3 + 1.2 = 4.2
    // reddit% = 71.4, hn% = 28.6
    const needs = [
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('hackernews'),
    ];
    const result = computeContributions(needs);
    expect(result).toHaveLength(2);
    expect(result[0]?.source).toBe('reddit');
    expect(result[1]?.source).toBe('hackernews');
    expect(result[0]?.percentage).toBeGreaterThan(result[1]?.percentage ?? 0);
  });

  it('权重生效: 相同 count,不同 weight → percentage 不同', () => {
    // google (1.0) 与 bing (0.9) 各 1 条
    // google% = 1.0/1.9 ≈ 52.6
    // bing% = 0.9/1.9 ≈ 47.4
    const needs = [makeNeed('google'), makeNeed('bing')];
    const result = computeContributions(needs);
    expect(result).toHaveLength(2);
    const google = result.find((r) => r.source === 'google');
    const bing = result.find((r) => r.source === 'bing');
    expect(google?.percentage).toBeCloseTo(52.6, 1);
    expect(bing?.percentage).toBeCloseTo(47.4, 1);
    expect(google?.percentage).toBeGreaterThan(bing?.percentage ?? 0);
  });

  it('百分比之和接近 100(允许浮点误差)', () => {
    const needs = [
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('hackernews'),
      makeNeed('google'),
      makeNeed('bing'),
    ];
    const result = computeContributions(needs);
    const sum = result.reduce((acc, r) => acc + r.percentage, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.5);
  });
});

describe('computeContributions: 兼容性', () => {
  it('未知 source 走 FALLBACK (weight=1, type=search)', () => {
    const needs = [makeNeed('unknown-source'), makeNeed('reddit')];
    const result = computeContributions(needs);
    const unknown = result.find((r) => r.source === 'unknown-source');
    expect(unknown).toMatchObject({
      type: 'search',
      weight: 1.0,
      count: 1,
    });
  });

  it('百分比保留 1 位小数(避免抖动)', () => {
    const needs = [
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('hackernews'),
    ];
    const result = computeContributions(needs);
    for (const r of result) {
      // 1 位小数 = 乘以 10 后是整数
      expect(Math.round(r.percentage * 10)).toBe(r.percentage * 10);
    }
  });
});

describe('computeContributions: env 覆盖', () => {
  it('INSIGHTFORGE_SOURCE_WEIGHTS 覆盖默认权重', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = 'reddit=2.0';
    const needs = [makeNeed('reddit'), makeNeed('hackernews')];
    // reddit weight=2.0, hn weight=1.2
    // reddit% = 2.0 / 3.2 = 62.5
    // hn% = 1.2 / 3.2 = 37.5
    const result = computeContributions(needs);
    const reddit = result.find((r) => r.source === 'reddit');
    const hn = result.find((r) => r.source === 'hackernews');
    expect(reddit?.weight).toBe(2.0);
    expect(reddit?.percentage).toBeCloseTo(62.5, 1);
    expect(hn?.percentage).toBeCloseTo(37.5, 1);
  });

  it('非法权重值被忽略,回退默认', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = 'reddit=abc,hackernews=1.5';
    const needs = [makeNeed('reddit'), makeNeed('hackernews')];
    const result = computeContributions(needs);
    const reddit = result.find((r) => r.source === 'reddit');
    // reddit 配置非法 → 回退默认 1.0
    expect(reddit?.weight).toBe(1.0);
    // hackernews 配置有效 → 1.5
    const hn = result.find((r) => r.source === 'hackernews');
    expect(hn?.weight).toBe(1.5);
  });

  it('负权重被忽略', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = 'reddit=-1';
    const needs = [makeNeed('reddit')];
    const result = computeContributions(needs);
    expect(result[0]?.weight).toBe(1.0);
  });
});

describe('computeContributions: ATTEMPTED_SOURCES 路径 (v1.7+)', () => {
  it('needs=[] + attemptedSources 非空 → 返回 0 命中源列表', () => {
    // 全 0 命中场景: needs 为空但本次调研实际尝试过的源要诚实展示
    const result = computeContributions([], ['reddit', 'hackernews']);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.count === 0)).toBe(true);
    expect(result.every((r) => r.percentage === 0)).toBe(true);
    // 两个源都应该带上 config(type/weight),即使 0 命中也是结构完整的
    for (const r of result) {
      expect(r.weight).toBeGreaterThan(0);
      expect(['forum', 'search', 'social', 'review']).toContain(r.type);
    }
  });

  it('needs 有数据 + attemptedSources 含 0 命中源 → 0 命中源 percentage=0 不稀释非零源', () => {
    // needs=[reddit×3], attemptedSources=[reddit, hackernews, weibo, xiaohongshu]
    // reddit 独享 100%, hn/weibo/xhs 都是 0%(不参与加权计算)
    const needs = [
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('reddit'),
    ];
    const result = computeContributions(needs, [
      'reddit',
      'hackernews',
      'weibo',
      'xiaohongshu',
    ]);
    expect(result).toHaveLength(4);
    const reddit = result.find((r) => r.source === 'reddit');
    const hn = result.find((r) => r.source === 'hackernews');
    const weibo = result.find((r) => r.source === 'weibo');
    const xhs = result.find((r) => r.source === 'xiaohongshu');
    expect(reddit?.count).toBe(3);
    expect(reddit?.percentage).toBe(100);
    expect(hn?.count).toBe(0);
    expect(hn?.percentage).toBe(0);
    expect(weibo?.count).toBe(0);
    expect(weibo?.percentage).toBe(0);
    expect(xhs?.count).toBe(0);
    expect(xhs?.percentage).toBe(0);
  });

  it('needs 有数据 + attemptedSources 含 0 命中源 → 百分比之和仍接近 100(不包含 0 源稀释)', () => {
    // needs=[reddit×3, hackernews×1], attemptedSources=[reddit, hackernews, weibo, xhs]
    // 总加权 = 3*1.0 + 1*1.2 = 4.2
    // reddit% = 71.4, hn% = 28.6, weibo/xhs% = 0
    // sum = 100(零源不参与)
    const needs = [
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('reddit'),
      makeNeed('hackernews'),
    ];
    const result = computeContributions(needs, [
      'reddit',
      'hackernews',
      'weibo',
      'xiaohongshu',
    ]);
    const sum = result.reduce((acc, r) => acc + r.percentage, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.5);
    // 排序: percentage 降序,相同 percentage 时 count 降序
    expect(result[0]?.source).toBe('reddit');
    expect(result[1]?.source).toBe('hackernews');
    // 0 命中源位置不固定(都是 0%),只保证非零源在前
    expect(result[2]?.percentage).toBe(0);
    expect(result[3]?.percentage).toBe(0);
  });
});
