/**
 * 共享类型定义(与 backend/src/types/index.ts 保持一致)
 */

/** 项目状态 */
export type ProjectStatus = 'draft' | 'analyzing' | 'completed' | 'failed';

/** 执行状态 */
export type ExecutionStatus = 'running' | 'success' | 'failed';

/**
 * 来源标识(与 backend/src/types/index.ts 保持一致)
 *
 * v1.7 扩展: 接入中文数据源(知乎/掘金实装,微博/小红书留接入骨架)。
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

/** v1.6: 数据源贡献度(后端 MarketResearcher 聚合写入) */
export interface ReportContribution {
  /** 来源原始标识,如 reddit / hackernews / google */
  source: string;
  /** 粗粒度分类,便于前端分组 */
  type: 'forum' | 'search' | 'social' | 'review';
  /** 本次调研中该 source 实际落库的条数 */
  count: number;
  /** 该 source 的默认权重 */
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
  /** v1.6: 数据源贡献度,MarketResearcher 聚合写入;老报告无此字段时为空数组 */
  contributions?: ReportContribution[];
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
    /** 业务错误码(如 MISSING_API_KEY),供前端决定是否弹窗引导 */
    error_code: ErrorCode | null;
    /** vNext: 调研过程实时指标(数据瀑布) */
    metrics: ExecutionMetrics | null;
  };
}

/** vNext: 单条瀑布样本(后端从聚合去重后的 top 100 投影而来) */
export interface ExecutionMetricSample {
  source: MarketNeedSource | string;
  title: string;
  url: string | null;
  engagement: number;
  crawled_at: string;
}

/** vNext: 数据源条数汇总 */
export interface ExecutionMetricBucket {
  source: MarketNeedSource | string;
  count: number;
  updated_at: string;
}

/** vNext: 调研过程实时指标 */
export interface ExecutionMetrics {
  buckets: ExecutionMetricBucket[];
  samples: ExecutionMetricSample[];
}

/** 业务错误码(与后端 backend/src/types/index.ts 保持一致) */
/**
 * 错误码分类:
 *   - MISSING_API_KEY        LLM 鉴权缺失(引导用户去设置)
 *   - INTERNAL_ERROR         兜底未知错误
 *   - SOURCE_*               多源采集引擎 v1.3 新增的细分(对应后端 SourceError.kind)
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

/** LLM 配置状态(后端 /api/v1/settings/llm 返回) */
/**
 * LLM 提供商 id 联合类型(与后端 backend/src/services/llm/providers.ts 一一对应)
 * 新增 Provider 时需同步扩展这里以及前端 lib/llmProviders.ts。
 */
export type LlmProvider =
  | 'deepseek'
  | 'openai'
  | 'ollama'
  | 'zhipu'
  | 'qwen'
  | 'moonshot'
  | 'yi'
  | 'MiniMax'
  | 'hunyuan'
  | 'sensenova'
  | 'stepfun';

export interface LlmStatus {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  runtimeOverride: boolean;
  /** 当前生效 provider 的 key 掩码(如 sk-****1234),用于设置页回显确认 */
  apiKeyMask: string;
  /** 各 provider 是否已配置 key(用于指示器状态展示) */
  providerKeyMap: Record<LlmProvider, boolean>;
}

/** LLM 预设模型选项(用于下拉选择) */
export interface LlmModelOption {
  provider: LlmProvider;
  model: string;
  label: string;
}

/** 触发调研响应 */
export interface TriggerResearchResponse {
  execution_id: string;
  status: ExecutionStatus;
  estimated_time: number;
}

/** 文档版本 */
export type DocVersion = 'mvp' | 'full';

/** 开发文档生成任务状态(后端 /projects/:id/docs/status 返回) */
export type DocsJobStatus = 'running' | 'success' | 'failed';

export interface DocsJob {
  status: DocsJobStatus;
  /** 人类可读当前步骤,前端轮询展示 */
  current_step: string;
  progress: number;
  total: number;
  /** 文档版本: mvp / full */
  version: DocVersion;
  started_at: string;
  finished_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  filenames: string[];
  /** 自动归档到"历史文档"目录后的绝对路径(供前端提示) */
  archive_path: string | null;
}

// ---------- 技术选型相关类型 ----------

export type TechSelectionStatus = 'running' | 'success' | 'failed';

export interface TechOption {
  name: string;
  reason: string;
  maturity: 'mature' | 'growing' | 'emerging';
  community_score: number;
  learning_curve: 'low' | 'medium' | 'high';
}

export interface FrontendStack {
  framework: TechOption;
  ui: TechOption;
  state_management: TechOption;
  build_tool: TechOption;
}

export interface BackendStack {
  language: TechOption;
  framework: TechOption;
  auth: TechOption;
  middleware: TechOption;
}

export interface DatabaseStack {
  primary: TechOption;
  cache?: TechOption;
  search?: TechOption;
}

export interface DeploymentStack {
  container: TechOption;
  ci_cd: TechOption;
  hosting: TechOption;
}

export interface ThirdPartyOption extends TechOption {
  category: string;
}

export interface TechStackPlan {
  plan_id: 'plan_a' | 'plan_b' | 'plan_c';
  plan_name: string;
  tagline: string;
  suitable_for: string;
  architecture: string;
  fit_score: number;
  risk_level: 'low' | 'medium' | 'high';
  frontend: FrontendStack;
  backend: BackendStack;
  database: DatabaseStack;
  deployment: DeploymentStack;
  third_party: ThirdPartyOption[];
  pros: string[];
  cons: string[];
  estimated_weeks: number;
}

export interface TechSelectionJob {
  status: TechSelectionStatus;
  current_step: string;
  started_at: string;
  finished_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  result: {
    recommended: 'plan_a' | 'plan_b' | 'plan_c';
    recommendation_reason: string;
    key_assumptions: string[];
    plans: TechStackPlan[];
    decision_dimensions: string[];
  } | null;
  selected_plan: 'plan_a' | 'plan_b' | 'plan_c' | null;
}

// ---------- 前端设计方案相关类型 ----------

export type FrontendDesignStatus = 'running' | 'success' | 'failed';

export interface FrontendDesignPlan {
  plan_id: 'plan_a' | 'plan_b' | 'plan_c';
  plan_name: string;
  tagline: string;
  suitable_for: string;
  design_style: {
    keywords: string[];
    color_palette: {
      primary: string;
      secondary: string;
      neutral: string;
      accent?: string;
    };
    typography: string;
    motion: string;
  };
  interaction_pattern: {
    navigation: string;
    core_flow: string;
    info_architecture: string;
  };
  responsive_strategy: {
    priority: 'mobile-first' | 'desktop-first' | 'equal';
    breakpoints: string;
    mobile_specific: string;
  };
  ui_library: {
    name: string;
    reason: string;
  };
  pros: string[];
  cons: string[];
}

export interface FrontendDesignJob {
  status: FrontendDesignStatus;
  current_step: string;
  started_at: string;
  finished_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  result: {
    recommended: 'plan_a' | 'plan_b' | 'plan_c';
    plans: FrontendDesignPlan[];
    decision_dimensions: string[];
  } | null;
  selected_plan: 'plan_a' | 'plan_b' | 'plan_c' | null;
}

/** 商业计划书生成任务状态(后端 /projects/:id/business-plan/status 返回) */
export type BpJobStatus = 'running' | 'success' | 'failed';

export interface BpJob {
  status: BpJobStatus;
  /** 人类可读当前步骤,前端轮询展示 */
  current_step: string;
  progress: number;
  total: number;
  started_at: string;
  finished_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  filenames: string[];
  /**
   * 自动归档目录的绝对路径:指向 12 份 md 所在的文件夹。
   * 桌面端通过此路径调用 shell.openPath 预览首份,或 IPC 复制到用户选定位置(另存)。
   * 未归档时为 null。
   */
  archive_path: string | null;
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

/** 历史文档归档条目(后端 /api/v1/archives 返回) */
export interface HistoryArchiveEntry {
  /** 项目归档文件夹绝对路径 */
  dir: string;
  /** 文件夹内文件名列表 */
  files: string[];
}

/** 历史文档归档结构: 项目名 -> 归档条目 */
export type HistoryArchives = Record<string, HistoryArchiveEntry>;

/** v1.6: 系统级健康检查响应(后端 GET /api/v1/health/system 返回) */
export interface SystemHealthDb {
  ok: boolean;
  latencyMs: number;
  error?: string;
}
export interface SystemHealthLlm {
  provider: string;
  model: string;
  configured: boolean;
}
export interface SystemHealthCache {
  enabled: boolean;
  total: number;
  active: number;
  expired: number;
}
export interface SystemHealthScheduler {
  running: boolean;
  intervalMs: number;
  firstDelayMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastRemoved: number | null;
  nextRunAt: string | null;
}
export interface SystemHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checkedAt: string;
  uptime: number;
  db: SystemHealthDb;
  llm: SystemHealthLlm;
  cache: SystemHealthCache;
  scheduler: SystemHealthScheduler;
  issues: string[];
}

/** v1.6: 单个调度任务状态(后端 GET /api/v1/admin/scheduler/status 返回) */
export interface SchedulerJobStatus {
  name: string;
  running: boolean;
  intervalMs: number;
  firstDelayMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastRemoved: number | null;
  lastError: string | null;
  nextRunAt: string | null;
}

/** v1.6: 全部调度任务状态响应 */
export interface SchedulerStatusResponse {
  schedulers: SchedulerJobStatus[];
  snapshotAt: string;
}

/** v2.0: 当前用户的配额信息(后端 GET /api/v1/auth/me 返回) */
export interface UserQuota {
  planType: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

/** v2.0: 当前登录用户的公开字段 */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  plan_type: string;
  quota: UserQuota;
}

/** v2.0: GET /api/v1/auth/me 返回 */
export interface AuthMeResponse {
  user: CurrentUser | null;
  authEnabled: boolean;
}

/** 桌面端 preload 暴露的桥接能力(浏览器中为 undefined) */
declare global {
  interface Window {
    insightforge?: {
      appVersion: string;
      platform: string;
      isDesktop: boolean;
      /** 用系统默认程序打开指定路径文件 */
      openPath: (p: string) => Promise<{ ok: boolean; message?: string }>;
      /**
       * 弹目录选择对话框,把 sourceDir 整个目录复制到用户选定位置。
       * 仅桌面端可用;浏览器中调用会 reject。
       */
      saveDir: (args: { sourceDir: string; defaultName: string }) => Promise<{
        ok: boolean;
        canceled?: boolean;
        targetDir?: string;
        message?: string;
      }>;
    };
  }
}

/** 应用设置(前端 localStorage) */
export interface AppSettings {
  llmProvider: LlmProvider;
  llmModel: string;
  searchProvider: 'openserp' | 'serpapi';
  searchUrl: string;
  /** SerpAPI Key(需要更精准的实时市场数据时自行申请并填写) */
  serpApiKey?: string;
  showApiKey: boolean;
}

// ---------- 讨论梳理画布 ----------

/** 梳理模式: 商业模式画布 / 精益画布 / SWOT / 软件项目 / 自由头脑风暴 */
export type DiscussionMode = 'business_model' | 'lean_canvas' | 'swot' | 'project' | 'free';

/** 画布要点状态: 草稿 / 已确认 / 待澄清 */
export type CanvasPointStatus = 'draft' | 'confirmed' | 'question';

export interface CanvasPoint {
  id: string;
  text: string;
  status: CanvasPointStatus;
  note?: string;
}

export interface CanvasGroup {
  id: string;
  title: string;
  points: CanvasPoint[];
}

export interface DiscussionCanvas {
  groups: CanvasGroup[];
}

export interface DiscussionMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

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

/** 画布操作(与后端讨论共用) */
export type DiscussionOp =
  | { op: 'add_point'; group_id: string; text: string; note?: string; status?: CanvasPointStatus }
  | { op: 'update_point'; point_id: string; text?: string; status?: CanvasPointStatus; note?: string }
  | { op: 'delete_point'; point_id: string }
  | { op: 'move_point'; point_id: string; to_group_id: string }
  | { op: 'add_group'; title: string }
  | { op: 'rename_group'; group_id: string; title: string }
  | { op: 'delete_group'; group_id: string };

/** 讨论任务状态(轮询) */
export interface DiscussionChatJob {
  status: ExecutionStatus;
  current_step: string;
  started_at: string;
  finished_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
}