/**
 * InsightForge 核心 SDK - 共享类型定义
 *
 * 与 backend/src/types/index.ts 保持语义一致,但只保留 SDK 需要的部分。
 * 字段含义与 dsh-plugin/src/types.ts 完全对齐(SDK 是其上游)。
 *
 * 设计要点:
 * 1. 不包含 Project / Execution 等数据库实体(SDK 消费者按需扩展)
 * 2. MarketReport 增加 `depth` 字段以区分 quick/standard/deep
 * 3. 所有结构在 ./schemas 中做运行时校验(LLM 输出)
 */

/** 项目状态 */
export type ProjectStatus = 'draft' | 'analyzing' | 'completed' | 'failed';

/** 执行状态(预留) */
export type ExecutionStatus = 'running' | 'success' | 'failed';

/** 调研深度档位 */
export type ResearchDepth = 'quick' | 'standard' | 'deep';

/** 数据来源标识 */
export type MarketNeedSource = 'reddit' | 'hackernews' | 'google' | 'bing' | 'producthunt';

/** 调研项目原始数据条目 */
export interface MarketNeed {
  id: string;
  content: string;
  source: MarketNeedSource;
  url: string | null;
  author: string | null;
  title: string | null;
  category: string | null;
  sentiment_score: number;
  engagement: number;
  tags: string[] | null;
  project_id: string;
  crawled_at: string;
}

/** 报告中引用的数据来源 */
export interface ReportSource {
  title: string;
  url: string;
  date?: string;
  source?: string;
}

/** 报告中识别的竞品 */
export interface ReportCompetitor {
  name: string;
  description: string;
  url?: string;
  strengths?: string[];
  weaknesses?: string[];
}

/** 市场热度指标 */
export interface ReportMarketHeat {
  search_volume: number;
  discussion_count: number;
  trend: 'rising' | 'stable' | 'declining';
  heat_score: number; // 0-100
}

/** 完整 7 章节市场报告 */
export interface MarketReport {
  summary: string;
  market_heat: ReportMarketHeat;
  competitors: ReportCompetitor[];
  pain_points: string[];
  market_size: string;
  risks: string[];
  opportunities: string[];
  sources: ReportSource[];
  /** LLM 不会输出,服务端补全 */
  generated_at: string;
  /** SDK 新增:产生该报告的调研深度 */
  depth: ResearchDepth;
  /** SDK 新增:产生该报告所用的关键词 */
  keywords: string[];
}

/** 兼容注:ValidatedKeywords 现由 schemas/report.ts 的 Zod 推断提供
 * (字段:keywords: string[2..8], reasoning?: string)。
 * SDK 公共 API 仅从 schemas 导出,本文件不再重复定义。
 */

// (以下历史 interface 已移除 —— 全部以 schemas/report.ts 为准)

/** search_demand 工具的检索结果(简化版 MarketNeed) */
export interface DemandHit {
  id: string;
  title: string | null;
  content: string;
  source: MarketNeedSource;
  url: string | null;
  engagement: number;
  crawled_at: string;
}

/** competitor_analysis 工具的输出 */
export interface CompetitorEntry extends ReportCompetitor {
  market_position?: 'leader' | 'challenger' | 'niche';
  source_urls?: string[];
}

/** 生成的落地页输出 */
export interface LandingPage {
  html: string;
  /** 字节数 */
  size: number;
  /** 主题 */
  theme: 'light' | 'dark';
}

/** 调研会话上下文(预留扩展) */
export interface ResearchSession {
  id: string;
  idea: string;
  depth: ResearchDepth;
  startedAt: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  progress: string;
}

/** InsightForge 核心聚合统计(预留服务返回值) */
export interface DemandStats {
  total: number;
  bySource: Partial<Record<MarketNeedSource, number>>;
  avgEngagement: number;
}
