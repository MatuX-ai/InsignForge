/**
 * 共享类型定义(与 backend/src/types/index.ts 保持一致)
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
  report?: MarketReport | null;
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
  heat_score: number;
}

/** 完整报告结构 */
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

/** 调研状态(轮询返回) */
export interface ResearchStatus {
  project_id: string;
  status: ProjectStatus;
  progress: string;
  execution: {
    id: string;
    status: ExecutionStatus;
    current_step: string;
    started_at: string;
    finished_at: string | null;
  };
}

/** 触发调研响应 */
export interface TriggerResearchResponse {
  execution_id: string;
  status: ExecutionStatus;
  estimated_time: number;
}

/** API 统一响应 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

/** 历史记录(前端 localStorage) */
export interface HistoryEntry {
  project_id: string;
  name: string;
  description: string;
  created_at: string;
}

/** 应用设置(前端 localStorage) */
export interface AppSettings {
  llmProvider: 'deepseek' | 'openai' | 'ollama';
  llmModel: string;
  searchProvider: 'openserp' | 'serpapi';
  searchUrl: string;
  showApiKey: boolean;
}