/**
 * 多源采集引擎 - 智能聚合器
 *
 * 职责:
 * 1. 按关键词并发调度多源(OpenSerp / SerpAPI + HN + Reddit)
 *    + v1.7 中文源(Zhihu / Juejin 实装,Weibo / Xiaohongshu 骨架)
 * 2. 单源失败隔离: 一个源挂掉不影响其他源
 * 3. 智能去重: URL 归一化 + 标题指纹,engagement 高者优先
 * 4. 按关键词维度并发限制(避免瞬时 3N 请求打外网)
 * 5. 截断到上限并落库
 */
import { searchOpenSerp } from './OpenSerpClient.js';
import { searchSerpApi } from './SerpApiClient.js';
import { searchHackerNews } from './HackerNewsClient.js';
import { searchReddit } from './RedditClient.js';
// v1.7 中文数据源: 知乎/掘金实装,微博/小红书留接入骨架
import { searchZhihu } from './ZhihuClient.js';
import { searchJuejin } from './JuejinClient.js';
import { searchWeibo } from './WeiboClient.js';
import { searchXiaohongshu } from './XiaohongshuClient.js';
import { dedupeItems, dedupeBySimilarTitle, DEFAULT_TITLE_DEDUPE_THRESHOLD } from './dedupe.js';
import { RerankerService } from '../RerankerService.js';
import { getSearchProvider, getSearchApiKey } from '../SettingsService.js';
import { MarketNeedService } from '../MarketNeedService.js';
import { logger } from '../../logger.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

/**
 * v1.4 智能化开关: LLM rerank 仅在传 description 时启用;
 * 关闭时不调用 LLM,不影响纯调用路径(讨论等)性能。
 */
function isRerankEnabled(): boolean {
  const raw = process.env.INSIGHTFORGE_RERANK;
  if (raw == null) return true;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** 关键词维度并发上限(同时打外网的最大关键词数) */
const KEYWORD_CONCURRENCY = 3;

type RawItem = Pick<
  MarketNeed,
  'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'
>;

/** 简易信号量:限制同时运行的任务数(纯本地实现,无 p-limit 依赖) */
function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  function release() {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  }
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

export const Aggregator = {
  /**
   * 按关键词聚合多源数据(不落库,纯内存返回)
   * 供讨论梳理等场景在对话中实时检索市场数据使用
   * @param keywords 搜索关键词数组
   * @param opts.description 可选;传入后会触发 v1.4 LLM rerank(对主题相关性更准,失败降级)
   * @param opts.onSamples 可选;每搜完一个关键词,把本批样本回调出来(供"数据瀑布"面板使用)。
   *                         不传则不入瀑布,讨论场景零开销。
   * @returns 去重排序后的原始条目(最多 100 条)
   */
  async aggregate(
    keywords: string[],
    opts: {
      description?: string;
      onSamples?: (samples: RawItem[]) => void;
    } = {}
  ): Promise<RawItem[]> {
    logger.info({ keywords, concurrency: KEYWORD_CONCURRENCY }, '开始聚合多源数据(内存模式)');

    // 搜索引擎按运行时 provider 分流: serpapi(需 Key) / openserp(自托管)
    const searchProvider = getSearchProvider();
    const serpApiKey = getSearchApiKey();
    const serpSearch = (kw: string) =>
      searchProvider === 'serpapi' && serpApiKey.trim()
        ? searchSerpApi(kw, serpApiKey, 'google')
        : searchOpenSerp(kw, 'google');

    // 单关键词内部: 七源并发;关键词之间: 限流(KEYWORD_CONCURRENCY)
    // v1.7: 已扩到 7 路 (Serp + HN + Reddit + Zhihu + Juejin + Weibo(骨架) + Xhs(骨架))
    const limit = createLimiter(KEYWORD_CONCURRENCY);

    const tasks = keywords.map((kw) =>
      limit(async () => {
        const [serp, hn, rd, zhihu, juejin, weibo, xhs] = await Promise.allSettled([
          serpSearch(kw),
          searchHackerNews(kw, 10),
          searchReddit(kw, 10),
          searchZhihu(kw, 10),
          searchJuejin(kw, 10),
          searchWeibo(kw, 10),
          searchXiaohongshu(kw, 10),
        ]);

        const collected: RawItem[] = [];
        const failed: string[] = [];
        if (serp.status === 'fulfilled') {
          for (const item of serp.value) collected.push({ ...item, author: null });
        } else {
          failed.push('serp');
        }
        if (hn.status === 'fulfilled') {
          collected.push(...hn.value);
        } else {
          failed.push('hackernews');
        }
        if (rd.status === 'fulfilled') {
          collected.push(...rd.value);
        } else {
          failed.push('reddit');
        }
        if (zhihu.status === 'fulfilled') {
          collected.push(...zhihu.value);
        } else {
          failed.push('zhihu');
        }
        if (juejin.status === 'fulfilled') {
          collected.push(...juejin.value);
        } else {
          failed.push('juejin');
        }
        // v1.7: 骨架源(weibo/xiaohongshu) 不接入熔断计数,默认永远是 fulfilled:[],
        // 此处同样推入 collected 即可;若未来实装后变 fulfilled 带数据,会自动贡献到聚合。
        if (weibo.status === 'fulfilled') {
          collected.push(...weibo.value);
        } else {
          failed.push('weibo');
        }
        if (xhs.status === 'fulfilled') {
          collected.push(...xhs.value);
        } else {
          failed.push('xiaohongshu');
        }
        if (failed.length > 0) {
          logger.debug({ kw, failed, got: collected.length }, '单关键词部分源失败');
        }
        return collected;
      })
    );

    const allResults = (await Promise.all(tasks)).flat();

    // 三层去重(URL 归一化 -> 标题指纹 -> 标题语义);日志记录每层压缩率便于排错
    const afterUrl = dedupeItems(allResults);
    const afterTitle = dedupeBySimilarTitle(afterUrl);
    const beforeCount = allResults.length;
    const afterCount = afterTitle.length;
    if (beforeCount !== afterCount) {
      logger.info(
        {
          beforeCount,
          afterUrlCount: afterUrl.length,
          afterTitleCount: afterCount,
          threshold: DEFAULT_TITLE_DEDUPE_THRESHOLD,
        },
        '标题语义去重生效'
      );
    }

    // v1.4 智能化: LLM rerank(仅在传入 description 且开关开启时启用)
    // 失败 / 验证不通过均降级到 engagement 排序,不影响主流程
    let finalOrder: RawItem[];
    if (opts.description && isRerankEnabled()) {
      const reranked = await RerankerService.rerank(opts.description, afterTitle);
      if (reranked) {
        finalOrder = reranked.indices.map((idx) => afterTitle[idx]!).filter(Boolean);
        logger.info(
          {
            rerankedCount: reranked.indices.length,
            reasoning: reranked.reasoning,
          },
          'LLM rerank 生效'
        );
      } else {
        // 降级:按 engagement 降序
        finalOrder = [...afterTitle].sort((a, b) => b.engagement - a.engagement);
      }
    } else {
      // 按 engagement 降序
      finalOrder = [...afterTitle].sort((a, b) => b.engagement - a.engagement);
    }

    // 截断到 100 条
    const finalTop = finalOrder.slice(0, 100);
    // vNext: 数据瀑布。回调里只读 finalTop,调用方负责把样本写 metrics。
    // 即使外部 throw,瀑布回调失败也不影响主流程——包一层 try/catch。
    if (opts.onSamples && finalTop.length > 0) {
      try {
        opts.onSamples(finalTop);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          '瀑布回调失败,不影响主流程'
        );
      }
    }
    return finalTop;
  },

  /**
   * 按关键词聚合多源数据并落库
   * @param keywords 搜索关键词数组
   * @param projectId 关联项目 ID
   * @param opts.description 可选;传入后会触发 v1.4 LLM rerank
   * @param opts.onSamples 可选;本批采集到的样本(去重+rerrank 后的最终 top)
   *                         回调给调用方写瀑布面板
   * @returns 实际写入数据库的条目数
   */
  async aggregateAndPersist(
    keywords: string[],
    projectId: string,
    opts: {
      description?: string;
      onSamples?: (samples: RawItem[]) => void;
    } = {}
  ): Promise<number> {
    logger.info({ keywords, projectId }, '开始聚合多源数据');

    const top = await this.aggregate(keywords, opts);

    if (top.length === 0) {
      logger.warn({ keywords }, '所有数据源均无返回');
      return 0;
    }

    const sourceCount: Record<MarketNeedSource | string, number> = {};
    for (const t of top) {
      sourceCount[t.source] = (sourceCount[t.source] ?? 0) + 1;
    }
    logger.info({ sourceCount, projectId }, '聚合完成,准备入库');

    const inserted = MarketNeedService.bulkInsert(
      top.map((t) => ({
        ...t,
        project_id: projectId,
        sentiment_score: 0,
        category: null,
        tags: null,
      }))
    );

    logger.info({ inserted, projectId }, '聚合数据入库完成');
    return inserted;
  },
};
