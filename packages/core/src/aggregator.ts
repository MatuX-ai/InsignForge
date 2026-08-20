/**
 * 数据聚合器
 *
 * 改编自 backend/src/services/search/Aggregator.ts:
 * 1. 并行调用多个数据源(OpenSerp + HN + Reddit)
 * 2. 去重(同 URL 只保留 engagement 最高)
 * 3. 简单打分 + 截断上限
 * 4. 落库(若 db 已初始化)
 *
 * SDK 适配:
 * - 不再依赖 ProjectService,直接接收 project_id 字符串
 * - searchLimit 按 depth 调整
 */
import { randomUUID } from 'node:crypto';
import type { Config } from './config-types.js';
import { logger } from './logger.js';
import { getDb } from './db.js';
import { searchHackerNews } from './hacker-news.js';
import { searchOpenSerp } from './open-serp.js';
import { searchReddit } from './reddit.js';
import type { MarketNeed, MarketNeedSource, ResearchDepth } from './types.js';

/** 三档深度对应的搜索条目上限 */
const SEARCH_LIMITS: Record<ResearchDepth, number> = {
  quick: 30,
  standard: 80,
  deep: 150,
};

export interface AggregateOptions {
  cfg: Config;
  keywords: string[];
  projectId: string;
  depth: ResearchDepth;
  /** 跳过落库(用于竞品分析等场景) */
  skipPersist?: boolean;
}

export interface AggregateResult {
  inserted: number;
  unique: number;
  bySource: Record<MarketNeedSource, number>;
}

export async function aggregate(opts: AggregateOptions): Promise<AggregateResult> {
  const { cfg, keywords, projectId, depth } = opts;
  const limit = SEARCH_LIMITS[depth];

  logger.info({ keywords, projectId, depth }, '开始聚合多源数据');

  const tasks = keywords.map(async (kw) => {
    const [serp, hn, rd] = await Promise.allSettled([
      searchOpenSerp(cfg, kw, 'google'),
      searchHackerNews(kw, 10),
      searchReddit(kw, 10),
    ]);

    const collected: Pick<
      MarketNeed,
      'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'
    >[] = [];

    if (serp.status === 'fulfilled') {
      for (const item of serp.value) collected.push({ ...item, author: null });
    }
    if (hn.status === 'fulfilled') collected.push(...hn.value);
    if (rd.status === 'fulfilled') collected.push(...rd.value);

    logger.debug(
      { kw, count: collected.length, sources: collected.map((c) => c.source) },
      '单关键词数据收集完成'
    );

    return collected;
  });

  const allResults = (await Promise.all(tasks)).flat();

  // 去重(同 URL 优先保留 engagement 最高)
  const dedupMap = new Map<string, (typeof allResults)[0]>();
  for (const item of allResults) {
    if (!item.url) continue;
    const existing = dedupMap.get(item.url);
    if (!existing || item.engagement > existing.engagement) {
      dedupMap.set(item.url, item);
    }
  }
  const unique = Array.from(dedupMap.values());

  // 按 engagement 降序,截断到上限
  unique.sort((a, b) => b.engagement - a.engagement);
  const top = unique.slice(0, limit);

  // 来源统计
  const bySource: Record<MarketNeedSource, number> = {
    reddit: 0,
    hackernews: 0,
    google: 0,
    bing: 0,
    producthunt: 0,
  };
  for (const t of top) bySource[t.source] = (bySource[t.source] ?? 0) + 1;

  if (top.length === 0) {
    logger.warn({ keywords }, '所有数据源均无返回');
    return { inserted: 0, unique: 0, bySource };
  }

  if (opts.skipPersist) {
    logger.info({ unique: top.length, bySource }, '跳过落库');
    return { inserted: 0, unique: top.length, bySource };
  }

  // 落库(FAQ Q4:复用同一份需求库)
  const inserted = bulkInsert(
    cfg,
    top.map((t) => ({
      id: randomUUID(),
      content: t.content,
      source: t.source,
      url: t.url,
      author: t.author ?? null,
      title: t.title,
      category: null,
      sentiment_score: 0,
      engagement: t.engagement,
      tags: null,
      project_id: projectId,
      crawled_at: new Date().toISOString(),
    }))
  );

  logger.info({ inserted, projectId }, '聚合数据入库完成');
  return { inserted, unique: top.length, bySource };
}

function bulkInsert(cfg: Config, needs: MarketNeed[]): number {
  const db = getDb(cfg);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO market_needs
     (id, content, source, url, author, title, category, sentiment_score, engagement, tags, project_id, crawled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((items: MarketNeed[]) => {
    let count = 0;
    for (const n of items) {
      const r = stmt.run(
        n.id,
        n.content,
        n.source,
        n.url,
        n.author,
        n.title,
        n.category,
        n.sentiment_score ?? 0,
        n.engagement ?? 0,
        n.tags ? JSON.stringify(n.tags) : null,
        n.project_id,
        n.crawled_at
      );
      if (r.changes > 0) count++;
    }
    return count;
  });
  return tx(needs);
}
