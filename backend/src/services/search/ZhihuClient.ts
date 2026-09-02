/**
 * 知乎搜索客户端(公开 API v4,无需登录)
 * 接口: https://www.zhihu.com/api/v4/search_v3?q=xxx&t=general&limit=10&offset=0
 *
 * ⚠️ 兼容性提示:
 *   知乎未公开承诺 search_v3 端点的稳定性;签名或风控策略可能随时变化。
 *   实测中常见 401(账号缺失) / 403(被风控) / 空 data 三种故障,本 Client 均按
 *   "失败降级返回空数组 + 不重试 4xx" 处理,与 HNClient 行为一致。
 *
 * 健壮性:
 *   - reliability.withReliability 接入重试(指数退避)+ 熔断 + 缓存 + 指标
 *   - 网络/5xx/429 自动重试 2 次,4xx 直接失败不重试
 *   - 同关键词 5min TTL 缓存(避免讨论环节重复打知乎)
 */
import { logger } from '../../logger.js';
import {
  SourceError,
  fetchWithRetry,
  hashKey,
  withReliability,
} from './reliability.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

const ZHIHU_SEARCH_URL = 'https://www.zhihu.com/api/v4/search_v3';
const SOURCE: MarketNeedSource = 'zhihu';
const RELIABILITY_SOURCE = 'zhihu';

// 浏览器 UA + Referer 是匿名访问 search_v3 的硬性条件(知乎会基于此区分爬虫)
const ZHIHU_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 知乎 search_v3 单条结果(只列实际用到的字段,其他静默忽略) */
interface ZhihuTarget {
  id?: number | string;
  type?: string;
  url?: string;
  /** 答案类目标会带 question 字段 */
  question?: { id?: number | string; url?: string };
}

interface ZhihuObject {
  id?: number | string;
  type?: 'answer' | 'article' | 'question' | 'video' | string;
  title?: string;
  excerpt?: string;
  detail?: string;
  voteup_count?: number;
  comment_count?: number;
  /** 知乎回答/文章的作者;提问型没有 author */
  author?: { name?: string; url_token?: string } | null;
  target?: ZhihuTarget;
}

interface ZhihuHit {
  type?: string;
  object?: ZhihuObject;
}

interface ZhihuResponse {
  data?: ZhihuHit[];
}

export async function searchZhihu(
  keyword: string,
  limit = 10
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[]> {
  if (!keyword.trim()) return [];
  const cacheKey = `${RELIABILITY_SOURCE}:${hashKey(`${keyword}|${limit}`)}`;

  return withReliability(
    { source: RELIABILITY_SOURCE, cacheKey },
    async () => {
      const url =
        `${ZHIHU_SEARCH_URL}?q=${encodeURIComponent(keyword)}&t=general` +
        `&limit=${limit}&offset=0&correction=1&search_type=content`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetchWithRetry(
          url,
          {
            signal: controller.signal,
            headers: {
              'User-Agent': ZHIHU_USER_AGENT,
              Referer: `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(keyword)}`,
              'x-requested-with': 'fetch',
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
          },
          {
            // 知乎偶发 5xx / 网络抖动;仅重试这些
            maxRetries: 2,
            baseDelayMs: 800,
            maxDelayMs: 3_500,
          }
        );
        const data = (await res.json()) as ZhihuResponse;
        const hits = Array.isArray(data?.data) ? data.data : [];
        return hits
          .map((h) => h?.object)
          .filter((o): o is ZhihuObject => !!o && typeof o === 'object')
          // 视频 / 纯提问帖不含正文,过滤以保证 content 字段有意义
          .filter((o) => o.type !== 'video' && o.type !== 'question')
          .map((o) => mapZhihuHit(keyword, o))
          .filter((m): m is NonNullable<typeof m> => m !== null);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), keyword },
          '知乎搜索失败,跳过'
        );
        return [];
      } finally {
        clearTimeout(timer);
      }
    }
  ).catch((): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[] => {
    // withReliability 总是 throw SourceError;此处仅负责 sentinel 返回 []
    return [];
  });
}

/**
 * 把一条知乎命中映射到 MarketNeed 形状。无法构造 URL 时返回 null(交由上层过滤)。
 */
function mapZhihuHit(
  keyword: string,
  o: ZhihuObject
): Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'> | null {
  const title = (o.title ?? '').toString().replace(/<[^>]*>/g, '').trim() || keyword;
  const contentRaw =
    o.excerpt ?? o.detail ?? o.title ?? '';
  const content = stripHtml(String(contentRaw)).slice(0, 1000);

  const url = resolveZhihuUrl(o);
  if (!url) return null;

  const authorName = o.author?.name ?? null;
  const engagement = (o.voteup_count ?? 0) + (o.comment_count ?? 0);

  return {
    title,
    content,
    url,
    source: SOURCE,
    engagement,
    author: authorName,
  };
}

/**
 * 构造知乎条目 URL:
 *   答案   → https://www.zhihu.com/question/{question.id}/answer/{target.id}
 *   文章   → https://zhuanlan.zhihu.com/p/{target.id}  (优先 target.url)
 *   其他   → target.url  兜底
 */
function resolveZhihuUrl(o: ZhihuObject): string | null {
  const t = o.target ?? {};
  if (o.type === 'answer' && t.question?.id !== undefined) {
    return (
      t.question.url ||
      `https://www.zhihu.com/question/${t.question.id}/answer/${t.id ?? ''}`
    );
  }
  if (o.type === 'article') {
    return t.url || (t.id ? `https://zhuanlan.zhihu.com/p/${t.id}` : null);
  }
  // 其他类型(question 已在上层过滤掉)尝试用 target.url 兜底
  return t.url ?? null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
