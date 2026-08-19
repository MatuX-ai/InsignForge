/**
 * insightforge/demand 服务 —— 文档 3.3 节
 *
 * 由 ctx.provide('insightforge/demand', service) 注入,
 * 供其他 dsh 插件通过 inject 声明依赖来使用。
 */
import type { InsightForgeCore } from '../core/researcher.js';
import type { DemandHit, DemandStats, MarketNeed } from '../types.js';

export interface DemandService {
  /** FTS5 全文检索(返回精简 DemandHit) */
  search(query: string, limit?: number): DemandHit[];
  /** 完整 MarketNeed(供需要原数据的下游插件使用) */
  searchNeeds(query: string, limit?: number): MarketNeed[];
  /** 统计 */
  stats(): DemandStats;
}

export function createDemandService(forge: InsightForgeCore): DemandService {
  return {
    search(query, limit = 20) {
      const needs = forge.searchDemand(query, limit);
      return needs.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        source: n.source,
        url: n.url,
        engagement: n.engagement,
        crawled_at: n.crawled_at,
      }));
    },
    searchNeeds(query, limit = 20) {
      return forge.searchDemand(query, limit);
    },
    stats() {
      const s = forge.demandStats();
      let avgEngagement = 0;
      if (s.total > 0) {
        // 抽样计算平均 engagement(性能可控,最多 1000 条)
        const allNeeds = forge.searchDemand('', 1000);
        if (allNeeds.length > 0) {
          avgEngagement =
            allNeeds.reduce((sum, n) => sum + n.engagement, 0) / allNeeds.length;
        }
      }
      return { ...s, avgEngagement };
    },
  };
}