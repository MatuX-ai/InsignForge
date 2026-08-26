/**
 * SerpAPI 客户端 - 搜索引擎封装
 *
 * 当设置页选择 SerpAPI 并填入 Key 时,用于获取真实 Google 搜索结果。
 * 失败时优雅降级(返回空数组,不抛出),由上层冷启动示例数据兜底。
 *
 * 文档: https://serpapi.com/search-api
 */
import { logger } from '../../logger.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
}

/** 单次搜索调用 */
export async function searchSerpApi(
  keyword: string,
  apiKey: string,
  source: MarketNeedSource = 'google'
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement'>[]> {
  if (!keyword.trim()) return [];
  if (!apiKey.trim()) {
    logger.warn({ keyword }, 'SerpAPI 未配置 Key,跳过');
    return [];
  }

  try {
    const url = `https://serpapi.com/search.json?engine=${source}&q=${encodeURIComponent(keyword)}&num=20&api_key=${encodeURIComponent(apiKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn({ status: res.status, keyword }, 'SerpAPI 返回非 200');
      return [];
    }

    const data = (await res.json()) as SerpApiResponse;
    if (data.error) {
      logger.warn({ error: data.error, keyword }, 'SerpAPI 返回错误');
      return [];
    }

    const results = data.organic_results ?? [];
    return results
      .filter((r) => r.link)
      .map((r) => ({
        content: r.snippet ?? '',
        title: r.title ?? keyword,
        url: r.link!,
        source,
        engagement: 0,
      }));
  } catch (err) {
    logger.warn({ err, keyword }, 'SerpAPI 调用失败,跳过');
    return [];
  }
}
