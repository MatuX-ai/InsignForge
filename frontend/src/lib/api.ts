/**
 * API 客户端封装
 * 基础路径 /api/v1,所有响应统一为 { code, message, data }
 */
import type {
  ApiResponse,
  Project,
  MarketReport,
  ResearchStatus,
  TriggerResearchResponse,
  LlmStatus,
  DocsJob,
  BpJob,
  DocVersion,
  TechSelectionJob,
  TechStackPlan,
  FrontendDesignJob,
  FrontendDesignPlan,
  DiscussionSession,
  DiscussionChatJob,
  DiscussionOp,
  DiscussionMode,
  HistoryArchives,
  SchedulerStatusResponse,
  SystemHealthResponse,
  AuthMeResponse,
} from '../types';

const BASE = '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      // v2.0: 必须携带 cookie(express-session / if.sid)以走鉴权分支
      credentials: 'include',
      ...init,
    });
  } catch (err) {
    // 网络层错误：后端不可达、DNS 失败、CORS 被拒等都会走到这里
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `后端服务不可达,请确认后端已启动 (http://localhost:3001) | ${detail}`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    // vite proxy 在 upstream 不可达时会返回 500 + 空 body(text/plain)
    // 这种情况下不能只显示 HTTP 500:,要给用户可读提示
    if (!text.trim()) {
      throw new Error(
        `后端服务异常 (HTTP ${res.status},响应为空)。通常是后端进程未启动或上游代理失败,请检查后端日志`
      );
    }
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const body = (await res.json()) as ApiResponse<T>;
  if (body.code !== 0) {
    throw new Error(body.message);
  }
  return body.data as T;
}

export const api = {
  // ----- 项目 -----
  createProject: (description: string, name?: string) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ description, name }),
    }),

  listProjects: () => request<Project[]>('/projects'),

  getProject: (id: string) => request<Project & { report: MarketReport | null }>(`/projects/${id}`),

  deleteProject: (id: string) =>
    request<null>(`/projects/${id}`, { method: 'DELETE' }),

  // ----- 调研 -----
  triggerResearch: (projectId: string) =>
    request<TriggerResearchResponse>(`/projects/${projectId}/research`, {
      method: 'POST',
    }),

  getStatus: (projectId: string) =>
    request<ResearchStatus>(`/projects/${projectId}/research/status`),

  getReport: (projectId: string) =>
    request<MarketReport>(`/projects/${projectId}/research/report`),

  // ----- 落地页生成 -----
  generateLanding: (projectId: string) =>
    request<{ html: string; size: number; theme: string; filename: string }>(
      `/projects/${projectId}/landing`,
      { method: 'POST' }
    ),

  // ----- 开发文档生成 -----
  /**
   * 触发开发文档生成(异步),立即返回 DocsJob
   * 同一项目多次调用会复用进行中的 job
   */
  triggerDocs: (
    projectId: string,
    options?: {
      version?: DocVersion;
      use_tech_selection?: boolean;
      use_frontend_design?: boolean;
      business_model?: string;
    }
  ) =>
    request<DocsJob>(`/projects/${projectId}/docs/generate`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }),

  /** 获取开发文档生成状态,用于轮询 */
  getDocsStatus: (projectId: string) =>
    request<DocsJob>(`/projects/${projectId}/docs/status`),

  /**
   * 开发文档 ZIP 下载地址(相对路径)
   * 直接触发下载,避免 blob 在 Electron 保存对话框期间被 revoke 导致失败
   */
  docsDownloadUrl: (projectId: string) =>
    `/projects/${projectId}/docs/download`,

  // ----- 技术选型 -----
  /** 触发技术选型分析(异步) */
  triggerTechSelection: (projectId: string) =>
    request<TechSelectionJob>(`/projects/${projectId}/tech-selection/generate`, {
      method: 'POST',
    }),

  /** 获取技术选型状态 */
  getTechSelectionStatus: (projectId: string) =>
    request<TechSelectionJob>(`/projects/${projectId}/tech-selection/status`),

  /** 用户确认选择某套技术方案 */
  selectTechPlan: (
    projectId: string,
    planId: 'plan_a' | 'plan_b' | 'plan_c'
  ) =>
    request<{ selected_plan: TechStackPlan }>(
      `/projects/${projectId}/tech-selection/select`,
      {
        method: 'POST',
        body: JSON.stringify({ plan_id: planId }),
      }
    ),

  // ----- 前端设计方案 -----
  /** 触发前端设计方案生成(异步) */
  triggerFrontendDesign: (projectId: string) =>
    request<FrontendDesignJob>(`/projects/${projectId}/frontend-design/generate`, {
      method: 'POST',
    }),

  /** 获取前端设计方案状态 */
  getFrontendDesignStatus: (projectId: string) =>
    request<FrontendDesignJob>(`/projects/${projectId}/frontend-design/status`),

  /** 用户确认选择某套前端设计方案 */
  selectFrontendDesignPlan: (
    projectId: string,
    planId: 'plan_a' | 'plan_b' | 'plan_c'
  ) =>
    request<{ selected_plan: FrontendDesignPlan }>(
      `/projects/${projectId}/frontend-design/select`,
      {
        method: 'POST',
        body: JSON.stringify({ plan_id: planId }),
      }
    ),

  // ----- 商业计划书生成 -----
  /**
   * 触发商业计划书生成(异步),立即返回 BpJob
   * 同一项目多次调用会复用进行中的 job
   */
  triggerBp: (projectId: string) =>
    request<BpJob>(`/projects/${projectId}/business-plan/generate`, {
      method: 'POST',
    }),

  /** 获取商业计划书生成状态,用于轮询 */
  getBpStatus: (projectId: string) =>
    request<BpJob>(`/projects/${projectId}/business-plan/status`),

  // ----- 报告导出 -----
  /**
   * 报告下载地址(.md | .pdf, 相对路径)
   * 直接触发下载,避免 blob 在 Electron 保存对话框期间被 revoke 导致失败
   */
  reportDownloadUrl: (projectId: string, format: 'md' | 'pdf') =>
    `/projects/${projectId}/export/${format === 'md' ? 'markdown' : 'pdf'}`,

  /**
   * 下载报告 (.md | .pdf),返回 Blob + 文件名
   * 主要用于 PDF: 需捕获后端 503(未找到 Chromium)以降级到浏览器打印
   */
  downloadReport: async (
    projectId: string,
    format: 'md' | 'pdf'
  ): Promise<{ blob: Blob; filename: string }> => {
    const path = `/projects/${projectId}/export/${format === 'md' ? 'markdown' : 'pdf'}`;
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `后端服务不可达,请确认后端已启动 (http://localhost:3001) | ${detail}`
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      // 服务端业务错误是 JSON { code, message },解析后再抛
      let msg = `HTTP ${res.status}`;
      if (text.trim().startsWith('{')) {
        try {
          const j = JSON.parse(text) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          msg = `${msg}: ${text}`;
        }
      } else if (text.trim()) {
        msg = `${msg}: ${text}`;
      }
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    // 解析 Content-Disposition 获取文件名
    const dispo = res.headers.get('Content-Disposition') ?? '';
    let filename = `report.${format === 'md' ? 'md' : 'pdf'}`;
    const starMatch = /filename\*\s*=\s*[^;]*''([^;]+)/i.exec(dispo);
    const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(dispo);
    const raw = starMatch ? decodeURIComponent(starMatch[1]!) : plainMatch?.[1];
    if (raw) filename = raw;
    const blob = await res.blob();
    return { blob, filename };
  },

  // ----- 需求库 -----
  searchNeeds: (keyword: string) =>
    request(`/market-needs?keyword=${encodeURIComponent(keyword)}`),

  // ----- 历史文档归档 -----
  /** 获取历史文档归档结构(项目名 -> 文件列表) */
  getArchives: () => request<HistoryArchives>('/archives'),

  // ----- 设置 -----
  getLlmStatus: () => request<LlmStatus>('/settings/llm'),

  /** 切换 provider / model(立即生效,后端会重建 LLM 单例) */
  updateLlmConfig: (config: { provider: string; model: string }) =>
    request<{ ok: boolean; message?: string }>('/settings/llm/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  /** 更新当前 provider 的 API Key(运行时 + 持久化) */
  updateLlmApiKey: (apiKey: string) =>
    request<{ ok: boolean; message?: string }>('/settings/llm/api-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  /** 更新搜索引擎配置(provider / SerpAPI Key,运行时 + 持久化) */
  updateSearchConfig: (input: {
    provider?: 'openserp' | 'serpapi';
    apiKey?: string;
  }) =>
    request<{ ok: boolean; message?: string }>('/settings/search', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  // ----- 讨论梳理画布 -----
  /** 创建梳理会话;带 message 时直接开聊(异步);projectId 用于关联项目(报告页"进一步探讨") */
  createDiscussion: (input: {
    title?: string;
    mode?: DiscussionMode;
    message?: string;
    projectId?: string;
    /** 内部使用: 创建后自动发起的首条消息,AI 会立即回复(用于"继续探讨"等场景) */
    firstMessage?: string;
  }) =>
    request<{ session: DiscussionSession; job: DiscussionChatJob | null }>('/discussions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 梳理会话列表 */
  listDiscussions: () => request<DiscussionSession[]>('/discussions'),

  /** 获取单个梳理会话(画布 + 对话) */
  getDiscussion: (id: string) => request<DiscussionSession>(`/discussions/${id}`),

  /** 删除梳理会话 */
  deleteDiscussion: (id: string) =>
    request<null>(`/discussions/${id}`, { method: 'DELETE' }),

  /** 触发一轮讨论(异步) */
  sendDiscussionMessage: (id: string, message: string) =>
    request<DiscussionChatJob>(`/discussions/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  /** 轮询讨论任务状态 */
  getDiscussionChatStatus: (id: string) =>
    request<DiscussionChatJob>(`/discussions/${id}/chat/status`),

  /** 手动应用画布操作(增删改要点 / 重组分组) */
  applyDiscussionOps: (id: string, operations: DiscussionOp[]) =>
    request<DiscussionSession>(`/discussions/${id}/canvas/apply`, {
      method: 'POST',
      body: JSON.stringify({ operations }),
    }),

  /** 触发画布整理(AI 去重/合并/归类) */
  organizeDiscussion: (id: string, instruction?: string) =>
    request<DiscussionChatJob>(`/discussions/${id}/organize`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }),

  /** 轮询画布整理任务状态 */
  getOrganizeStatus: (id: string) =>
    request<DiscussionChatJob>(`/discussions/${id}/organize/status`),

  // ----- v1.6 监控面板 -----
  /** 系统级健康(DB / LLM / Cache / Scheduler) */
  getSystemHealth: () => request<SystemHealthResponse>('/health/system'),

  /** 所有已注册调度任务的运行状态(来自方向 ① 的注册表) */
  getSchedulerStatus: () => request<SchedulerStatusResponse>('/admin/scheduler/status'),

  // ----- v2.0 OIDC / Casdoor -----
  /** 当前登录用户(未登录返回 { user: null }) */
  getMe: () => request<AuthMeResponse>('/auth/me'),

  /** 触发 OIDC 登录(浏览器跳转到 Casdoor);前端直接 window.location.href 即可 */
  startLogin: () => {
    window.location.href = `${BASE}/auth/login`;
  },

  /** 注销 */
  logout: () => request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),
};