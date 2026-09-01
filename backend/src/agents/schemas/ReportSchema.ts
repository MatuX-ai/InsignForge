/**
 * 报告结构 Zod Schema
 * 用于校验 LLM 输出的 JSON 是否符合前端约定的 MarketReport 结构
 *
 * 按 docs/03-技术文档.md §3.8 + docs/01-项目说明与需求说明书.md §7.2 设计:
 *   报告包含:执行摘要 / 市场热度 / 竞品识别 / 用户痛点 / 市场规模估算 / 风险与机会 / 数据来源
 *
 * v1.6 新增 contributions 字段:
 *   由 MarketResearcher 在生成报告时基于已落库的 market_needs 按 source 聚合,
 *   写入 report_data JSON 一起入库;前端无需再次统计。
 *   .default([]) 保证老报告 JSON 仍能通过校验。
 */
import { z } from 'zod';

export const ReportSourceSchema = z.object({
  title: z.string().min(1),
  // LLM 在"无公开数据、基于 AI 知识估计"场景下会给空 url,允许空串避免校验失败
  url: z.string().url().or(z.string()),
  date: z.string().optional(),
  source: z.string().optional(),
});

/**
 * 数据源贡献度(v1.6)
 * - source: 原始来源标识,如 reddit / hackernews / google
 * - type: 粗粒度分类(forum / search / social / review),便于前端分组展示
 * - count: 本次调研中该 source 实际落库的条数
 * - weight: 该 source 的默认权重(可被环境变量覆盖),用于权重百分比计算
 * - percentage: 0~100,加权后占比,前端可直接渲染
 */
export const ReportContributionSchema = z.object({
  source: z.string().min(1),
  type: z.enum(['forum', 'search', 'social', 'review']),
  count: z.number().int().nonnegative(),
  weight: z.number().positive(),
  percentage: z.number().min(0).max(100),
});

export const CompetitorSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
});

export const MarketHeatSchema = z.object({
  search_volume: z.number().nonnegative(),
  discussion_count: z.number().nonnegative(),
  trend: z.enum(['rising', 'stable', 'declining']),
  heat_score: z.number().min(0).max(100),
});

export const MarketReportSchema = z.object({
  summary: z.string().min(10),
  market_heat: MarketHeatSchema,
  competitors: z.array(CompetitorSchema).max(20),
  pain_points: z.array(z.string().min(1)).max(20),
  market_size: z.string().min(1),
  risks: z.array(z.string().min(1)).max(20),
  opportunities: z.array(z.string().min(1)).max(20),
  sources: z.array(ReportSourceSchema).max(50),
  /** v1.6: 数据源贡献度(由 MarketResearcher 聚合写入) */
  contributions: z.array(ReportContributionSchema).default([]),
});

/** 关键词提取结果 schema */
export const KeywordExtractionSchema = z.object({
  keywords: z.array(z.string().min(1)).min(2).max(8),
  reasoning: z.string().optional(),
});

export type ValidatedMarketReport = z.infer<typeof MarketReportSchema>;
export type ValidatedContribution = z.infer<typeof ReportContributionSchema>;
export type ValidatedKeywords = z.infer<typeof KeywordExtractionSchema>;
