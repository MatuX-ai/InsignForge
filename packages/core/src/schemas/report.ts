/**
 * 市场报告 Zod Schema(运行时校验 LLM 输出)
 *
 * 与 backend/src/agents/schemas/ReportSchema.ts 字段结构一致,
 * 仅在末尾补充 depth/keywords 可选字段供 SDK 使用。
 */
import { z } from 'zod';

export const ReportSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
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

export const KeywordExtractionSchema = z.object({
  keywords: z.array(z.string().min(1)).min(2).max(8),
  reasoning: z.string().optional(),
});

export type ValidatedMarketReport = z.infer<typeof MarketReportSchema>;
export type ValidatedKeywords = z.infer<typeof KeywordExtractionSchema>;
export type ValidatedCompetitor = z.infer<typeof CompetitorSchema>;
