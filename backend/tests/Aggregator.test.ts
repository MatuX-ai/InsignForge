/**
 * search/Aggregator.ts 集成测试
 *
 * 覆盖:
 *   - aggregate 单源失败不影响其他源(隔离)
 *   - 关键词维度并发限制(N=10 时实际同时运行 ≤ 3)
 *   - 智能去重(URL 归一化合并)
 *   - 空 keywords 直接返回空
 *   - 去重后按 engagement 降序 + 截断 100
 *   - v1.7: 7 源同时并发;骨架源(weibo/xhs)默认返回 []
 *
 * Mock 策略:
 *   - 直接 vi.mock 7 个客户端,返回受控数据
 *   - 不打外网;并通过 metrics/bundle reset 隔离状态
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// 受控返回
const mockSearchOpenSerp = vi.fn();
const mockSearchSerpApi = vi.fn();
const mockSearchHackerNews = vi.fn();
const mockSearchReddit = vi.fn();
// v1.7 新增中文源 mock;默认返回空数组,避免老用例不显式 mock 时新源报错
const mockSearchZhihu = vi.fn().mockResolvedValue([]);
const mockSearchJuejin = vi.fn().mockResolvedValue([]);
// 骨架源: mock 返回恒为空数组(与 Weibo/XhsClient.ts 默认实现一致)
const mockSearchWeibo = vi.fn().mockResolvedValue([]);
const mockSearchXiaohongshu = vi.fn().mockResolvedValue([]);

vi.mock('../src/services/search/OpenSerpClient.js', () => ({
  searchOpenSerp: (...args: unknown[]) => mockSearchOpenSerp(...args),
}));
vi.mock('../src/services/search/SerpApiClient.js', () => ({
  searchSerpApi: (...args: unknown[]) => mockSearchSerpApi(...args),
}));
vi.mock('../src/services/search/HackerNewsClient.js', () => ({
  searchHackerNews: (...args: unknown[]) => mockSearchHackerNews(...args),
}));
vi.mock('../src/services/search/RedditClient.js', () => ({
  searchReddit: (...args: unknown[]) => mockSearchReddit(...args),
}));
vi.mock('../src/services/search/ZhihuClient.js', () => ({
  searchZhihu: (...args: unknown[]) => mockSearchZhihu(...args),
}));
vi.mock('../src/services/search/JuejinClient.js', () => ({
  searchJuejin: (...args: unknown[]) => mockSearchJuejin(...args),
}));
vi.mock('../src/services/search/WeiboClient.js', () => ({
  searchWeibo: (...args: unknown[]) => mockSearchWeibo(...args),
}));
vi.mock('../src/services/search/XiaohongshuClient.js', () => ({
  searchXiaohongshu: (...args: unknown[]) => mockSearchXiaohongshu(...args),
}));

// SettingsService mock: 强制走 OpenSerp 路径,SerpApi 不被调用
vi.mock('../src/services/SettingsService.js', () => ({
  getSearchProvider: () => 'openserp',
  getSearchApiKey: () => '',
}));

import { Aggregator } from '../src/services/search/Aggregator.js';
import { resetAllSourceBundles, sourceMetrics } from '../src/services/search/reliability.js';

beforeEach(() => {
  mockSearchOpenSerp.mockReset();
  mockSearchSerpApi.mockReset();
  mockSearchHackerNews.mockReset();
  mockSearchReddit.mockReset();
  // v1.7: 中文源 reset 后重设默认空数组,避免老 case 触发 undefined
  mockSearchZhihu.mockReset().mockResolvedValue([]);
  mockSearchJuejin.mockReset().mockResolvedValue([]);
  // 骨架源默认被设为恒返回空;不需要每次 reset
  sourceMetrics.reset();
  resetAllSourceBundles();
});

describe('Aggregator.aggregate - 基本行为', () => {
  it('空 keywords 直接返回空', async () => {
    const out = await Aggregator.aggregate([]);
    expect(out).toEqual([]);
    expect(mockSearchOpenSerp).not.toHaveBeenCalled();
    expect(mockSearchHackerNews).not.toHaveBeenCalled();
    expect(mockSearchReddit).not.toHaveBeenCalled();
    expect(mockSearchZhihu).not.toHaveBeenCalled();
    expect(mockSearchJuejin).not.toHaveBeenCalled();
  });

  it('单关键词: 七源全部 fulfilled,合并返回(含 v1.7 中文源)', async () => {
    mockSearchOpenSerp.mockResolvedValueOnce([
      { title: 'G1', content: 'g', url: 'https://g.com/1', source: 'google', engagement: 0 },
    ]);
    mockSearchHackerNews.mockResolvedValueOnce([
      { title: 'H1', content: 'h', url: 'https://hn.com/1', source: 'hackernews', engagement: 100, author: 'hn-user' },
    ]);
    mockSearchReddit.mockResolvedValueOnce([
      { title: 'R1', content: 'r', url: 'https://r.com/1', source: 'reddit', engagement: 50, author: 'r-user' },
    ]);
    mockSearchZhihu.mockResolvedValueOnce([
      { title: 'Z1', content: 'z', url: 'https://zhihu.com/q/1', source: 'zhihu', engagement: 30, author: 'z-user' },
    ]);
    mockSearchJuejin.mockResolvedValueOnce([
      { title: 'J1', content: 'j', url: 'https://juejin.cn/post/1', source: 'juejin', engagement: 20, author: 'j-user' },
    ]);

    const out = await Aggregator.aggregate(['kw']);
    // 骨架源(weibo/xhs)返回 0 条,实际 5 个源各 1 条
    expect(out).toHaveLength(5);
    const srcs = out.map((o) => o.source).sort();
    expect(srcs).toEqual(['google', 'hackernews', 'juejin', 'reddit', 'zhihu']);
  });

  it('单关键词: 知乎/掘金 失败不影响其他源(隔离)', async () => {
    mockSearchOpenSerp.mockResolvedValueOnce([
      { title: 'G1', content: 'g', url: 'https://g.com/1', source: 'google', engagement: 0 },
    ]);
    mockSearchHackerNews.mockResolvedValueOnce([
      { title: 'H1', content: 'h', url: 'https://hn.com/1', source: 'hackernews', engagement: 100, author: 'hn-user' },
    ]);
    mockSearchReddit.mockResolvedValueOnce([
      { title: 'R1', content: 'r', url: 'https://r.com/1', source: 'reddit', engagement: 50, author: 'r-user' },
    ]);
    mockSearchZhihu.mockRejectedValueOnce(new Error('zhihu down'));
    mockSearchJuejin.mockRejectedValueOnce(new Error('juejin down'));

    const out = await Aggregator.aggregate(['kw']);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.source).sort()).toEqual(['google', 'hackernews', 'reddit']);
  });

  it('骨架源(weibo/xhs) 返回空数组,不计入失败且不影响其他源', async () => {
    mockSearchOpenSerp.mockResolvedValueOnce([
      { title: 'G1', content: 'g', url: 'https://g.com/1', source: 'google', engagement: 0 },
    ]);
    mockSearchHackerNews.mockResolvedValueOnce([
      { title: 'H1', content: 'h', url: 'https://hn.com/1', source: 'hackernews', engagement: 100, author: 'hn-user' },
    ]);
    mockSearchReddit.mockResolvedValueOnce([]);

    const out = await Aggregator.aggregate(['kw']);
    expect(out).toHaveLength(2);
    // 骨架源幂等返回 [],未走 "failed" 分支 → 不上报 circuit_opened 事件
    const metrics = sourceMetrics.snapshot('weibo');
    const mList = Array.isArray(metrics) ? metrics : [metrics];
    expect(mList[0]?.total ?? 0).toBe(0);
  });

  it('所有源失败 → 返回空数组(不抛)', async () => {
    mockSearchOpenSerp.mockRejectedValueOnce(new Error('g down'));
    mockSearchHackerNews.mockRejectedValueOnce(new Error('h down'));
    mockSearchReddit.mockRejectedValueOnce(new Error('r down'));
    mockSearchZhihu.mockRejectedValueOnce(new Error('z down'));
    mockSearchJuejin.mockRejectedValueOnce(new Error('j down'));
    const out = await Aggregator.aggregate(['kw']);
    expect(out).toEqual([]);
  });
});

describe('Aggregator.aggregate - 并发控制', () => {
  it('多关键词时 OpenSerp 同时运行的任务数不超过 3', async () => {
    // 关注点: Aggregator 的 limit 是按"关键词"维度,单关键词内 3 源仍并发。
    // 因此只让 OpenSerp 走阻塞 record,HN/Reddit 立即返回,峰值只反映关键词维度的并发。
    let running = 0;
    let peak = 0;
    const record = async () => {
      running += 1;
      peak = Math.max(peak, running);
      // 模拟 50ms 的网络耗时
      await new Promise((r) => setTimeout(r, 50));
      running -= 1;
      return [];
    };
    mockSearchOpenSerp.mockImplementation(record);
    mockSearchHackerNews.mockResolvedValue([]);
    mockSearchReddit.mockResolvedValue([]);

    const kws = Array.from({ length: 10 }, (_, i) => `kw-${i}`);
    await Aggregator.aggregate(kws);

    // KEYWORD_CONCURRENCY = 3
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // 至少并发 > 1,确认并发生效
  });
});

describe('Aggregator.aggregate - 智能去重', () => {
  it('同一 URL(utm 差异)视为同一,engagement 高者胜出', async () => {
    mockSearchOpenSerp.mockResolvedValueOnce([
      { title: 'G1', content: 'g1', url: 'https://g.com/1?utm_source=x', source: 'google', engagement: 1 },
    ]);
    mockSearchHackerNews.mockResolvedValueOnce([
      { title: 'H1', content: 'h1', url: 'https://g.com/1', source: 'hackernews', engagement: 10, author: 'u' },
    ]);
    mockSearchReddit.mockResolvedValueOnce([]);

    const out = await Aggregator.aggregate(['kw']);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('hackernews');
    expect(out[0]!.engagement).toBe(10);
  });
});

describe('Aggregator.aggregate - 排序与截断', () => {
  it('按 engagement 降序 + 截断到 100', async () => {
    // 构造 120 条,engagement = 1..120
    const items = (source: 'google' | 'hackernews' | 'reddit', base: number) =>
      Array.from({ length: 40 }, (_, i) => ({
        title: `T-${source}-${i}`,
        content: '',
        url: `https://${source}.com/${i}?v=${base}`,
        source,
        engagement: base + i,
        author: null,
      }));
    mockSearchOpenSerp.mockResolvedValueOnce(items('google', 1));
    mockSearchHackerNews.mockResolvedValueOnce(items('hackernews', 41));
    mockSearchReddit.mockResolvedValueOnce(items('reddit', 81));

    const out = await Aggregator.aggregate(['kw']);
    expect(out).toHaveLength(100);
    // engagement 应递减
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.engagement).toBeGreaterThanOrEqual(out[i]!.engagement);
    }
  });
});
