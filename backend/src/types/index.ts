/**
 * 共享类型定义
 * 与前端 frontend/src/types/index.ts 保持一致
 */

/** 项目状态 */
export type ProjectStatus = 'draft' | 'analyzing' | 'completed' | 'failed';

/** 执行状态 */
export type ExecutionStatus = 'running' | 'success' | 'failed';

/** 来源标识 */
export type MarketNeedSource = 'reddit' | 'hackernews' | 'google' | 'bing' | 'producthunt';

/** 调研项目 */
export interface Project {
  id: string;
  user_id: string | null;
  name: string;
  description: string;
  keywords: string[] | null;
  status: ProjectStatus;
  progress: string;
  created_at: string;
  updated_at: string;
}

/** 市场调研原始条目 */
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

/** 报告中的单个数据来源 */
export interface ReportSource {
  title: string;
  url: string;
  date?: string;
  source?: string;
}

/** 报告中的竞品 */
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

/** 完整报告结构(LLM 输出 schema) */
export interface MarketReport {
  summary: string;
  market_heat: ReportMarketHeat;
  competitors: ReportCompetitor[];
  pain_points: string[];
  market_size: string;
  risks: string[];
  opportunities: string[];
  sources: ReportSource[];
  generated_at: string;
}

/** 项目报告记录 */
export interface ProjectReport {
  id: string;
  project_id: string;
  report_data: MarketReport;
  generated_at: string;
}

/** 执行记录 */
export interface Execution {
  id: string;
  project_id: string;
  workflow_id: string | null;
  status: ExecutionStatus;
  current_step: string;
  logs: Array<{ timestamp: string; level: string; message: string }>;
  started_at: string;
  finished_at: string | null;
}

/** API 统一响应包装 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

/** 创建项目请求 */
export interface CreateProjectRequest {
  name?: string;
  description: string;
}

/** 触发调研响应 */
export interface TriggerResearchResponse {
  execution_id: string;
  status: ExecutionStatus;
  estimated_time: number;
}