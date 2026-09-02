/**
 * 共享类型定义
 * 与前端 frontend/src/types/index.ts 保持一致
 */

/** 项目状态 */
export type ProjectStatus = 'draft' | 'analyzing' | 'completed' | 'failed';

/** 执行状态 */
export type ExecutionStatus = 'running' | 'success' | 'failed';

/**
 * 来源标识
 *
 * v1.7 扩展: 接入中文数据源(知乎/掘金实装,微博/小红书留接入骨架)。
 * 新增时需同步:
 *   - frontend/src/types/index.ts (前端 MarketNeedSource 一致)
 *   - backend/src/services/search/sourceWeights.ts (默认权重 + type)
 *   - backend/src/services/search/Aggregator.ts (Promise.allSettled 挂接)
 */
export type MarketNeedSource =
  | 'reddit'
  | 'hackernews'
  | 'google'
  | 'bing'
  | 'producthunt'
  | 'zhihu'
  | 'juejin'
  | 'weibo'
  | 'xiaohongshu';

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

/** v1.6: 数据源贡献度(由后端 MarketResearcher 在生成报告时聚合) */
export interface ReportContribution {
  /** 来源原始标识,如 reddit / hackernews / google */
  source: string;
  /** 粗粒度分类,便于前端分组渲染 */
  type: 'forum' | 'search' | 'social' | 'review';
  /** 本次调研中该 source 实际落库的条数 */
  count: number;
  /** 该 source 的默认权重(可被环境变量覆盖) */
  weight: number;
  /** 0~100,加权后占比,前端可直接渲染 */
  percentage: number;
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
  /** v1.6: 数据源贡献度,MarketResearcher 聚合写入;老报告无此字段时为空数组 */
  contributions?: ReportContribution[];
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
/**
 * 错误码分类:
 *   - MISSING_API_KEY        LLM 鉴权缺失(引导用户去设置)
 *   - INTERNAL_ERROR         兜底未知错误
 *   - SOURCE_*               多源采集引擎 v1.3 新增的细分(对应 SourceError.kind),
 *                            由前端映射为更友好的中文提示
 */
export type ErrorCode =
  | 'MISSING_API_KEY'
  | 'INTERNAL_ERROR'
  | 'SOURCE_NETWORK'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_RATE_LIMIT'
  | 'SOURCE_SERVER_5XX'
  | 'SOURCE_BAD_GATEWAY'
  | 'SOURCE_UNKNOWN_HTTP'
  | 'SOURCE_CLIENT_4XX'
  | 'SOURCE_PARSE'
  | 'SOURCE_CIRCUIT_OPEN'
  | 'SOURCE_VALIDATION';

/** 数据源单条样本(瀑布流中的一行) */
export interface ExecutionMetricSample {
  /** 数据源原始标识,如 reddit / hackernews / google */
  source: MarketNeedSource | string;
  /** 抓取到的标题或内容片段 */
  title: string;
  /** 来源链接(可空,爬虫/搜索引擎不一定都有) */
  url: string | null;
  /** 该条目的互动量(评论/点赞等) */
  engagement: number;
  /** 该条目进入瀑布的相对时间戳(ISO) */
  crawled_at: string;
}

/** 数据源贡献度汇总(瀑布面板顶部统计) */
export interface ExecutionMetricBucket {
  source: MarketNeedSource | string;
  /** 该源实际采集到的条数 */
  count: number;
  /** 最近一次更新时间 */
  updated_at: string;
}

/**
 * 调研过程实时指标(仅内存,不持久化):
 *   - buckets 按源汇总已采集条数
 *   - samples 取最近 N 条,作为"数据瀑布"展示
 * 前端每 3s 轮询 status 时取走渲染。
 */
export interface ExecutionMetrics {
  buckets: ExecutionMetricBucket[];
  samples: ExecutionMetricSample[];
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
  /** 业务错误码(如 MISSING_API_KEY),供前端识别并弹窗 */
  error_code?: ErrorCode;
  /** vNext: 调研过程实时指标(仅内存,进程重启即清空) */
  metrics?: ExecutionMetrics;
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