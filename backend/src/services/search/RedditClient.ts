/**
 * Reddit 抓取 - 基于 Reddit 公开 JSON 接口(无需 API Key)
 * https://www.reddit.com/r/all/search.json?q=xxx&limit=25
 *
 * 注意: Reddit 会基于 UA 返回不同内容,这里使用浏览器 UA
 *
 * 健壮性:
 *   - 通过 reliability.withReliability 接入重试(指数退避)+ 熔断 + 缓存 + 指标
 *   - 网络/5xx/429 自动重试 2 次,4xx 直接失败不重试
 *   - 同关键词 5min TTL 缓存
 */
import { logger } from '../../logger.js';
import {
  SourceError,
  fetchWithRetry,
  hashKey,
  withReliability,
} from './reliability.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';
const SOURCE: MarketNeedSource = 'reddit';
const RELIABILITY_SOURCE = 'reddit';

interface RedditChild {
  data: {
    id: string;
    title: string;
    selftext?: string;
    url: string;
    subreddit: string;
    author: string;
    score: number;
    num_comments: number;
    permalink: string;
    created_utc: number;
  };
}

interface RedditResponse {
  data: {
    children: RedditChild[];
  };
}

export async function searchReddit(
  keyword: string,
  limit = 25
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[]> {
  if (!keyword.trim()) return [];
  const cacheKey = `${RELIABILITY_SOURCE}:${hashKey(`${keyword}|${limit}`)}`;

  return withReliability(
    { source: RELIABILITY_SOURCE, cacheKey },
    async () => {
      const url = `${REDDIT_SEARCH_URL}?q=${encodeURIComponent(keyword)}&limit=${limit}&sort=relevance&restrict_sr=&t=year`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetchWithRetry(
          url,
          {
            signal: controller.signal,
            headers: {
              'User-Agent': 'InsightForge/1.0 (https://github.com/your-repo)',
            },
          },
          {
            maxRetries: 2,
            baseDelayMs: 800,
            maxDelayMs: 3_500,
          }
        );
        const data = (await res.json()) as RedditResponse;
        return data.data.children
          .filter((c) => c.data.title)
          .map((c) => {
            const d = c.data;
            return {
              title: d.title,
              content: d.selftext || d.title,
              url: `https://www.reddit.com${d.permalink}`,
              source: SOURCE,
              engagement: (d.score ?? 0) + (d.num_comments ?? 0),
              author: d.author,
            };
          });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), keyword },
          'Reddit 搜索失败,跳过'
        );
        return [];
      } finally {
        clearTimeout(timer);
      }
    }
  ).catch((err): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[] => {
    if (err instanceof SourceError) return [];
    return [];
  });
}
