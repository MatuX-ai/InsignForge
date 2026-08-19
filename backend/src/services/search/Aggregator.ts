/**
 * 数据聚合器
 *
 * 职责:
 * 1. 并行调用多个数据源(OpenSerp + HN + Reddit)
 * 2. 去重(同 URL 只保留第一条)
 * 3. 简单打分(engagement 高者优先)
 * 4. 截断到上限并落库
 */
import { searchOpenSerp } from './OpenSerpClient.js';
import { searchHackerNews } from './HackerNewsClient.js';
import { searchReddit } from './RedditClient.js';
import { MarketNeedService } from '../MarketNeedService.js';
import { logger } from '../../logger.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

export const Aggregator = {
  /**
   * 按关键词聚合多源数据
   * @param keywords 搜索关键词数组
   * @param projectId 关联项目 ID
   * @returns 实际写入数据库的条目数
   */
  async aggregateAndPersist(keywords: string[], projectId: string): Promise<number> {
    logger.info({ keywords, projectId }, '开始聚合多源数据');

    const tasks = keywords.map(async (kw) => {
      const [serp, hn, rd] = await Promise.allSettled([
        searchOpenSerp(kw, 'google'),
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
    const dedupMap = new Map<string, typeof allResults[0]>();
    for (const item of allResults) {
      if (!item.url) continue;
      const existing = dedupMap.get(item.url);
      if (!existing || item.engagement > existing.engagement) {
        dedupMap.set(item.url, item);
      }
    }
    const unique = Array.from(dedupMap.values());

    // 按 engagement 降序,截断到 100 条
    unique.sort((a, b) => b.engagement - a.engagement);
    const top = unique.slice(0, 100);

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