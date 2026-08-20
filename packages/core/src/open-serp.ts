/**
 * OpenSerp 客户端 - 搜索引擎封装
 *
 * - 调用 OpenSerp 获取搜索结果
 * - 适配为统一的 MarketNeed 列表
 * - 失败时优雅降级(返回空数组,不抛出)
 */
import type { Config } from './config-types.js';
import { logger } from './logger.js';
import type { MarketNeed, MarketNeedSource } from './types.js';

interface OpenSerpResult {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
}

interface OpenSerpResponse {
  results?: OpenSerpResult[];
}

/** 单次搜索调用 */
export async function searchOpenSerp(
  cfg: Config,
  keyword: string,
  source: MarketNeedSource = 'google'
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement'>[]> {
  if (!keyword.trim()) return [];

  try {
    const url = `${cfg.searchEndpoint.replace(/\/$/, '')}/search/${source}?q=${encodeURIComponent(keyword)}&engine=${source}&num=20`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ status: res.status, keyword }, 'OpenSerp 返回非 200');
      return [];
    }

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
    logger.warn({ err, keyword }, 'OpenSerp 调用失败,跳过');
    return [];
  }
}
