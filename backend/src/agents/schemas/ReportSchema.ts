/**
 * 报告结构 Zod Schema
 * 用于校验 LLM 输出的 JSON 是否符合前端约定的 MarketReport 结构
 *
 * 按 docs/03-技术文档.md §3.8 + docs/01-项目说明与需求说明书.md §7.2 设计:
 *   报告包含:执行摘要 / 市场热度 / 竞品识别 / 用户痛点 / 市场规模估算 / 风险与机会 / 数据来源
 */
import { z } from 'zod';

export const ReportSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().or(z.string().min(1)),
  date: z.string().optional(),
  source: z.string().optional(),
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
});

/** 关键词提取结果 schema */
export const KeywordExtractionSchema = z.object({
  keywords: z.array(z.string().min(1)).min(2).max(8),
  reasoning: z.string().optional(),
});

export type ValidatedMarketReport = z.infer<typeof MarketReportSchema>;
export type ValidatedKeywords = z.infer<typeof KeywordExtractionSchema>;