/**
 * Hacker News 搜索客户端(Algolia 公开 API,无需 Key)
 * 改编自 backend/src/services/search/HackerNewsClient.ts
 */
import { logger } from '../logger.js';
import type { MarketNeed, MarketNeedSource } from '../types.js';

const HN_ALGOLIA_URL = 'https://hn.algolia.com/api/v1/search';

interface HNAlgoliaHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  url?: string | null;
  author: string;
  points?: number | null;
  num_comments?: number | null;
  created_at: string;
}

interface HNAlgoliaResponse {
  hits: HNAlgoliaHit[];
}

export async function searchHackerNews(
  keyword: string,
  limit = 20
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[]> {
  if (!keyword.trim()) return [];

  try {
    const url = `${HN_ALGOLIA_URL}?query=${encodeURIComponent(keyword)}&hitsPerPage=${limit}&tags=story`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ status: res.status, keyword }, 'HN Algolia 返回非 200');
      return [];
    }

    const data = (await res.json()) as HNAlgoliaResponse;
    const source: MarketNeedSource = 'hackernews';

    return data.hits
      .filter((h) => h.url || h.story_title || h.title)
      .map((h) => {
        const title = h.title ?? h.story_title ?? keyword;
        const content = h.story_text ?? title;
        const engagement = (h.points ?? 0) + (h.num_comments ?? 0);
        return {
          title,
          content: stripHtml(content),
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          source,
          engagement,
          author: h.author,
        };
      });
  } catch (err) {
    logger.warn({ err, keyword }, 'HN 搜索失败,跳过');
    return [];
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').slice(0, 1000);
}