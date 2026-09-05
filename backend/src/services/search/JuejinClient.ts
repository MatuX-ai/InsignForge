/**
 * 掘金搜索客户端(公开 REST API,无需登录)
 * 接口: https://api.juejin.cn/search_api/v1/search  (POST application/json)
 *
 * 注意: 掘金的搜索端点在历史上有过迁移(search → search_api/v1/search),
 * 任何一次端点失效都会导致匿名抓取退化为空命中。当前实现按"宽松字段读取"编写,
 * 取不到期望字段时直接返回空数组,由上层 UI 在卡片上诚实显示 0 条。
 *
 * 健壮性:
 *   - reliability.withReliability 接入重试(指数退避)+ 熔断 + 缓存 + 指标
 *   - 网络/5xx/429 自动重试 2 次,4xx 直接失败不重试
 *   - 同关键词 5min TTL 缓存(避免讨论环节重复打掘金)
 */
import { logger } from '../../logger.js';
import {
  SourceError,
  fetchWithRetry,
  hashKey,
  withReliability,
} from './reliability.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

const JUEJIN_SEARCH_URL = 'https://api.juejin.cn/search_api/v1/search';
const SOURCE: MarketNeedSource = 'juejin';
const RELIABILITY_SOURCE = 'juejin';

// v1.7+: 全局首次 0 命中时 warn 一次。匿名下极易返回空数组,避免日志被刷屏。
let warnedEmptyOnce = false;

/** 仅供测试:重置 warnedEmptyOnce 标志,避免跨 it 共享状态污染。 */
export function _resetWarnedEmptyForTest(): void {
  warnedEmptyOnce = false;
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 掘金 article_info 单条记录的字段(部分平台接口字段名略不同,做兼容) */
interface JuejinArticle {
  article_id?: string;
  title?: string;
  brief_content?: string;
  content?: string;
  ctime?: string | number;
  /** 点赞数 */
  digg_count?: number;
  comment_count?: number;
  view_count?: number;
  /** 浏览量在不同端点叫法不同 */
  user_counter?: number;
  /** 兼容包一层 author */
  author?: { name?: string };
  author_name?: string;
}

interface JuejinSearchItem {
  /** 旧端点直接挂 article_info;新端点挂 result_data.article_info */
  article_info?: JuejinArticle;
  result_data?: { article_info?: JuejinArticle };
  /** 部分端点把字段直接展开 */
  article_id?: string;
  title?: string;
}

interface JuejinResponse {
  err_no?: number;
  err_msg?: string;
  data?: JuejinArticle[] | { result?: JuejinSearchItem[] } | unknown;
}

export async function searchJuejin(
  keyword: string,
  limit = 10
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[]> {
  if (!keyword.trim()) return [];
  const cacheKey = `${RELIABILITY_SOURCE}:${hashKey(`${keyword}|${limit}`)}`;

  return withReliability(
    { source: RELIABILITY_SOURCE, cacheKey },
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetchWithRetry(
          JUEJIN_SEARCH_URL,
          {
            signal: controller.signal,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': BROWSER_USER_AGENT,
              Accept: 'application/json, text/plain, */*',
              Origin: 'https://juejin.cn',
              Referer: `https://juejin.cn/search?query=${encodeURIComponent(keyword)}`,
            },
            body: JSON.stringify({
              query: keyword,
              page: 0,
              page_size: limit,
              search_type: 0,
              id_type: 0,
              sort_type: 0,
            }),
          },
          {
            maxRetries: 2,
            baseDelayMs: 800,
            maxDelayMs: 3_500,
          }
        );
        const data = (await res.json()) as JuejinResponse;
        // err_no !== 0 时掘金端返回的是业务错误,统一按空命中处理(不算网络错误)
        if (data?.err_no !== undefined && data.err_no !== 0) {
          logger.debug({ err_no: data.err_no, keyword }, '掘金搜索业务错误,视为无命中');
          return [];
        }
        const items = extractJuejinArticles(data);
        // v1.7+: juejin 在匿名下极易返回空数组(端点迁移 / 风控均会触发),
        // 进程级首次 0 命中时 warn 一次,避免日志被刷屏。
        if (items.length === 0 && !warnedEmptyOnce) {
          warnedEmptyOnce = true;
          logger.warn(
            { source: SOURCE, keyword, errNo: data?.err_no },
            '掘金搜索 0 命中(匿名风控 / search 端点迁移均会触发,前端报告卡片会显示 juejin 贡献为 0)'
          );
        }
        return items;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), keyword },
          '掘金搜索失败,跳过'
        );
        return [];
      } finally {
        clearTimeout(timer);
      }
    }
  ).catch((): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[] => {
    return [];
  });
}

/**
 * 宽松解析掘金 search 响应: 兼容 data 是数组、对象 {result:[...]} 或 result_data 包裹等多种形态。
 */
function extractJuejinArticles(
  data: JuejinResponse
): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[] {
  const out: Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[] = [];
  const d = data?.data as unknown;
  const items: JuejinArticle[] = [];

  if (Array.isArray(d)) {
    // 直接是 article_info 数组(经典 search 端点形态)
    for (const it of d) {
      if (it && typeof it === 'object') items.push(it as JuejinArticle);
    }
  } else if (d && typeof d === 'object') {
    // 新端点: data.result[*].article_info 或 .result_data.article_info
    const resultField = (d as { result?: JuejinSearchItem[] }).result;
    if (Array.isArray(resultField)) {
      for (const it of resultField) {
        const a =
          it?.article_info ||
          it?.result_data?.article_info ||
          // 包一层 v2 字段
          (it as unknown as JuejinArticle);
        if (a && (a.article_id || a.title)) items.push(a as JuejinArticle);
      }
    }
  }

  for (const a of items) {
    const mapped = mapJuejinArticle(a);
    if (mapped) out.push(mapped);
  }
  return out;
}

function mapJuejinArticle(
  a: JuejinArticle
): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'> | null {
  const articleId = a.article_id;
  if (!articleId) return null;
  const title = (a.title ?? '').toString().trim() || '(无标题)';
  const content = stripHtml(String(a.brief_content ?? a.content ?? a.title ?? '')).slice(0, 1000);
  const url = `https://juejin.cn/post/${articleId}`;
  const author = a.author?.name ?? a.author_name ?? null;
  const viewCount = a.view_count ?? a.user_counter ?? 0;
  const engagement =
    (a.digg_count ?? 0) + (a.comment_count ?? 0) + Math.floor((viewCount || 0) / 10);
  return { title, content, url, source: SOURCE, engagement, author };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
