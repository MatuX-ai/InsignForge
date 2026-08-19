/**
 * Reddit 抓取 - 基于 Reddit 公开 JSON 接口(无需 Key)
 * 改编自 backend/src/services/search/RedditClient.ts
 */
import { logger } from '../logger.js';
import type { MarketNeed, MarketNeedSource } from '../types.js';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';

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

  try {
    const url = `${REDDIT_SEARCH_URL}?q=${encodeURIComponent(keyword)}&limit=${limit}&sort=relevance&restrict_sr=&t=year`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'insightforge-dsh-plugin/0.1 (https://github.com/your-org/insightforge-dsh-plugin)',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ status: res.status, keyword }, 'Reddit 返回非 200');
      return [];
    }

    const data = (await res.json()) as RedditResponse;
    const source: MarketNeedSource = 'reddit';

    return data.data.children
      .filter((c) => c.data.title)
      .map((c) => {
        const d = c.data;
        return {
          title: d.title,
          content: d.selftext || d.title,
          url: `https://www.reddit.com${d.permalink}`,
          source,
          engagement: (d.score ?? 0) + (d.num_comments ?? 0),
          author: d.author,
        };
      });
  } catch (err) {
    logger.warn({ err, keyword }, 'Reddit 搜索失败,跳过');
    return [];
  }
}