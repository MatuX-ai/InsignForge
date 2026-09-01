/**
 * OpenSerp 客户端 - 搜索引擎封装
 *
 * OpenSerp 是开源的 SERP API,提供 Google / Bing / DuckDuckGo 等的搜索结果
 * 自托管方式: docker run -p 8080:8080 ghcr.io/openserp/openserp:latest
 *
 * 本客户端负责:
 * - 调用 OpenSerp 获取搜索结果
 * - 适配为统一的 MarketNeed 列表
 * - 失败时优雅降级(返回空数组,不抛出)
 *
 * 健壮性:
 *   - reliability.withReliability: 重试 + 熔断 + 缓存 + 指标
 *   - 同一 engine+keyword 5min TTL 缓存
 */
import { logger } from '../../logger.js';
import { config } from '../../config.js';
import {
  SourceError,
  fetchWithRetry,
  hashKey,
  withReliability,
} from './reliability.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

interface OpenSerpResult {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
}

interface OpenSerpResponse {
  results?: OpenSerpResult[];
}

const RELIABILITY_SOURCE = 'openserp';

/** 单次搜索调用 */
export async function searchOpenSerp(
  keyword: string,
  source: MarketNeedSource = 'google'
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement'>[]> {
  if (!keyword.trim()) return [];
  const cacheKey = `${RELIABILITY_SOURCE}:${hashKey(`${keyword}|${source}`)}`;

  return withReliability(
    { source: RELIABILITY_SOURCE, cacheKey },
    async () => {
      const url = `${config.OPENSERP_URL}/search/${source}?q=${encodeURIComponent(keyword)}&engine=${source}&num=20`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      try {
        const res = await fetchWithRetry(
          url,
          { signal: controller.signal },
          { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 5_000 }
        );
        const data = (await res.json()) as OpenSerpResponse;
        const results = data.results ?? [];
        return results
          .filter((r) => r.url)
          .map((r) => ({
            content: r.description ?? r.snippet ?? '',
            title: r.title ?? keyword,
            url: r.url!,
            source,
            engagement: 0,
          }));
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), keyword },
          'OpenSerp 调用失败,跳过'
        );
        return [];
      } finally {
        clearTimeout(timer);
      }
    }
  ).catch((err): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement'>[] => {
    if (err instanceof SourceError) return [];
    return [];
  });
}
