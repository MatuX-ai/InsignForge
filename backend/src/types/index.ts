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

/** 业务错误码 - 用于前端识别特定错误类型以决定是否弹窗引导 */
export type ErrorCode = 'MISSING_API_KEY' | 'INTERNAL_ERROR';

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
  /** 业务错误码(如 MISSING_API_KEY),供前端识别并弹窗 */
  error_code?: ErrorCode;
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

// ---------- 讨论梳理画布 ----------

/** 梳理模式: 商业模式画布 / 精益画布 / SWOT / 软件项目 / 自由头脑风暴 */
export type DiscussionMode = 'business_model' | 'lean_canvas' | 'swot' | 'project' | 'free';

/** 画布要点状态: 草稿 / 已确认 / 待澄清 */
export type CanvasPointStatus = 'draft' | 'confirmed' | 'question';

/** 画布上的单个要点 */
export interface CanvasPoint {
  id: string;
  text: string;
  status: CanvasPointStatus;
  note?: string;
}

/** 画布分组(一个维度/主题) */
export interface CanvasGroup {
  id: string;
  title: string;
  points: CanvasPoint[];
}

/** 讨论画布: 分组 → 要点 */
export interface DiscussionCanvas {
  groups: CanvasGroup[];
}

/** 讨论会话中的一条消息 */
export interface DiscussionMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/** 讨论会话 */
export interface DiscussionSession {
  id: string;
  /** 关联的项目 ID(报告页"进一步探讨"等场景),无关联时为 null */
  project_id: string | null;
  title: string;
  mode: DiscussionMode;
  canvas: DiscussionCanvas;
  messages: DiscussionMessage[];
  created_at: string;
  updated_at: string;
}

/** 画布操作(LLM 输出 & 前端手动编辑共用) */
export type DiscussionOp =
  | { op: 'add_point'; group_id: string; text: string; note?: string; status?: CanvasPointStatus }
  | { op: 'update_point'; point_id: string; text?: string; status?: CanvasPointStatus; note?: string }
  | { op: 'delete_point'; point_id: string }
  | { op: 'move_point'; point_id: string; to_group_id: string }
  | { op: 'add_group'; title: string }
  | { op: 'rename_group'; group_id: string; title: string }
  | { op: 'delete_group'; group_id: string };

/** 一轮讨论 LLM 的输出: 回复 + 对画布的操作 */
export interface DiscussionTurnResult {
  reply: string;
  operations: DiscussionOp[];
}

/** 讨论消息处理任务状态(异步,前端轮询) */
export interface DiscussionChatJob {
  status: ExecutionStatus;
  current_step: string;
  started_at: string;
  finished_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
}