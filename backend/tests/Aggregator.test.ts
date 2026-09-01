/**
 * search/Aggregator.ts 集成测试
 *
 * 覆盖:
 *   - aggregate 单源失败不影响其他源(隔离)
 *   - 关键词维度并发限制(N=10 时实际同时运行 ≤ 3)
 *   - 智能去重(URL 归一化合并)
 *   - 空 keywords 直接返回空
 *   - 去重后按 engagement 降序 + 截断 100
 *
 * Mock 策略:
 *   - 直接 vi.mock 4 个客户端,返回受控数据
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
  });

  it('单关键词: 三源全部 fulfilled,合并返回', async () => {
    mockSearchOpenSerp.mockResolvedValueOnce([
      { title: 'G1', content: 'g', url: 'https://g.com/1', source: 'google', engagement: 0 },
    ]);
    mockSearchHackerNews.mockResolvedValueOnce([
      { title: 'H1', content: 'h', url: 'https://hn.com/1', source: 'hackernews', engagement: 100, author: 'hn-user' },
    ]);
    mockSearchReddit.mockResolvedValueOnce([
      { title: 'R1', content: 'r', url: 'https://r.com/1', source: 'reddit', engagement: 50, author: 'r-user' },
    ]);

    const out = await Aggregator.aggregate(['kw']);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.source).sort()).toEqual(['google', 'hackernews', 'reddit']);
  });

  it('单关键词: HN 失败不影响 OpenSerp 与 Reddit', async () => {
    mockSearchOpenSerp.mockResolvedValueOnce([
      { title: 'G1', content: 'g', url: 'https://g.com/1', source: 'google', engagement: 0 },
    ]);
    mockSearchHackerNews.mockRejectedValueOnce(new Error('hn down'));
    mockSearchReddit.mockResolvedValueOnce([
      { title: 'R1', content: 'r', url: 'https://r.com/1', source: 'reddit', engagement: 50, author: 'r-user' },
    ]);

    const out = await Aggregator.aggregate(['kw']);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.source).sort()).toEqual(['google', 'reddit']);
  });

  it('所有源失败 → 返回空数组(不抛)', async () => {
    mockSearchOpenSerp.mockRejectedValueOnce(new Error('g down'));
    mockSearchHackerNews.mockRejectedValueOnce(new Error('h down'));
    mockSearchReddit.mockRejectedValueOnce(new Error('r down'));
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
