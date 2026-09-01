/**
 * Hacker News 搜索客户端(Algolia 公开 API,无需爬虫)
 * 接口: https://hn.algolia.com/api/v1/search?query=xxx
 * 返回: 帖子列表(包含互动量、URL、作者、时间)
 *
 * 健壮性:
 *   - 通过 reliability.withReliability 接入重试(指数退避)+ 熔断 + 缓存 + 指标
 *   - 网络/5xx/429 自动重试 2 次,4xx 直接失败不重试
 *   - 同关键词 5min TTL 缓存(避免讨论环节重复打 HN)
 */
import { logger } from '../../logger.js';
import {
  SourceError,
  fetchWithRetry,
  hashKey,
  withReliability,
} from './reliability.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

const HN_ALGOLIA_URL = 'https://hn.algolia.com/api/v1/search';
const SOURCE: MarketNeedSource = 'hackernews';
const RELIABILITY_SOURCE = 'hackernews';

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
  _tags?: string[];
}

interface HNAlgoliaResponse {
  hits: HNAlgoliaHit[];
}

export async function searchHackerNews(
  keyword: string,
  limit = 20
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[]> {
  if (!keyword.trim()) return [];
  const cacheKey = `${RELIABILITY_SOURCE}:${hashKey(`${keyword}|${limit}`)}`;

  return withReliability(
    { source: RELIABILITY_SOURCE, cacheKey },
    async () => {
      const url = `${HN_ALGOLIA_URL}?query=${encodeURIComponent(keyword)}&hitsPerPage=${limit}&tags=story`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetchWithRetry(
          url,
          { signal: controller.signal },
          {
            // HN 偶发 503; 网络抖动; 仅重试这些
            maxRetries: 2,
            baseDelayMs: 600,
            maxDelayMs: 3_000,
          }
        );
        const data = (await res.json()) as HNAlgoliaResponse;
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
              source: SOURCE,
              engagement,
              author: h.author,
            };
          });
      } catch (err) {
        // 兜底: 与原行为一致,失败返回空数组(供上层冷启动)
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), keyword },
          'HN 搜索失败,跳过'
        );
        return [];
      } finally {
        clearTimeout(timer);
      }
    }
  ).catch((err): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[] => {
    // 熔断打开也会到达这里;与原行为保持一致返回空数组
    if (err instanceof SourceError) return [];
    return [];
  });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').slice(0, 1000);
}
