/**
 * insightforge/report 服务 —— 文档 3.3 节
 *
 * 提供报告生成能力,供其他 dsh 插件直接复用(跳过工具调用层)
 */
import { reportCacheKey, type ReportCache } from '../core/cache.js';
import type { InsightForgeCore, ResearchRequest, ResearchResult } from '../core/researcher.js';
import type { MarketReport, ResearchDepth } from '../types.js';

export interface ReportService {
  /** 同步版本:直接返回完整报告 */
  generate(req: ResearchRequest): Promise<ResearchResult>;
  /** 仅返回报告(不含 aggregate 元信息) */
  generateReportOnly(req: ResearchRequest): Promise<MarketReport>;
  /** 检查是否有缓存命中 */
  peekCache(idea: string, depth?: ResearchDepth): MarketReport | null;
}

export function createReportService(forge: InsightForgeCore): ReportService {
  return {
    async generate(req) {
      return forge.research(req);
    },
    async generateReportOnly(req) {
      const r = await forge.research(req);
      return r.report;
    },
    peekCache(idea, depth = 'standard') {
      const cache = (forge as unknown as { reportCache: ReportCache | null }).reportCache;
      if (!cache) return null;
      const key = reportCacheKey(idea, depth);
      return cache.get(key) ?? null;
    },
  };
}