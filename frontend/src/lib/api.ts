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
  ProjectSearchResult,
  PluginManifest,
} from '../types';

/** API 基础路径(内部统一使用 BASE) */
const BASE = '/api/v1';
/** 导出供少数特殊场景复用(如 Report.tsx 的「复制 Markdown」直接 fetch 下载端点) */
export const API_BASE = BASE;

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
  /**
   * v1.7.1 FR-14: 落地页生成,支持自定义 CTA / 表单字段 / 主题
   * options 全可选, 不传则使用后端智能默认值(根据 idea / vp 推萘 CTA)
   */
  generateLanding: (
    projectId: string,
    options?: {
      theme?: 'light' | 'dark';
      call_to_action?: string;
      call_to_action_subtext?: string;
      success_message?: string;
      form_fields?: Array<{
        name: string;
        type: 'email' | 'phone' | 'text';
        label: string;
        placeholder?: string;
        required?: boolean;
      }>;
    }
  ) =>
    request<{ html: string; size: number; theme: string; filename: string }>(
      `/projects/${projectId}/landing`,
      { method: 'POST', body: JSON.stringify(options ?? {}) }
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

  // ----- v1.8 P9-C: 项目快照导出/导入(.insightforge) -----
  /**
   * 项目快照下载 URL(.insightforge = ZIP STORE)
   * 浏览器直接 <a href={url} download> 触发下载。
   */
  insightforgeDownloadUrl: (projectId: string) =>
    `/projects/${projectId}/export/insightforge`,

  /**
   * 上传 .insightforge 文件,后端会创建一份新项目,返回新项目对象。
   * 这里不走通用 request() (因为 Content-Type 是 octet-stream,响应是 JSON)。
   */
  importInsightforge: async (file: File): Promise<Project> => {
    const buf = await file.arrayBuffer();
    const res = await fetch(`${BASE}/projects/import/insightforge`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      if (!text.trim()) {
        throw new Error(`后端服务异常 (HTTP ${res.status},响应为空)`);
      }
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as ApiResponse<Project>;
    if (body.code !== 0) {
      throw new Error(body.message);
    }
    return body.data as Project;
  },

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

  /**
   * WARN-04 修复: Web 版归档打包下载
   * 返回相对后端下载路径,在浏览器中触发 anchor.download 即可。
   */
  archiveDownloadUrl: (projectKey: string) =>
    `/api/v1/archives/${encodeURIComponent(projectKey)}/download`,

  /**
   * v1.8 P2-C: 删除某个项目的历史归档目录
   * URL: DELETE /api/v1/archives/:projectKey
   *
   *   - 仅清理文件系统,不动数据库项目记录
   *   - 用于「删除并清理归档」场景: 由 ProjectCard 删除二级菜单触发
   *   - 归档不存在时服务端返回 removed=false,但仍视为成功(幂等)
   *   - 调用前应先保证 projectKey 是 sanitizeArchiveKey 后的目录名,
   *     否则 400
   */
  deleteArchive: (projectKey: string) =>
    request<{ removed: boolean }>(
      `/archives/${encodeURIComponent(projectKey)}`,
      { method: 'DELETE' }
    ),

  /**
   * FR-10 跨项目全文检索:
   *   q     关键词
   *   limit 返回条数上限(默认 30)
   * 返回 { hits: SearchHit[], total: number, q: string }
   * hit.snippets 在 UI 上展示「哪句话命中了」
   */
  searchProjects: (q: string, limit = 30) =>
    request<ProjectSearchResult>(`/projects/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // ----- 插件系统 (v1.7.1 FR-13) -----
  /** 列出所有已注册的插件,设置页可查看"当前用哪个生成器" */
  listPlugins: () => request<PluginManifest[]>('/plugins'),
  /** 单个插件详情 */
  getPlugin: (id: string) => request<PluginManifest>(`/plugins/${encodeURIComponent(id)}`),

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

  /**
   * 更新全局应用配置 - FR-08 代理池 / FR-18 离线模式
   * 前后端约定:后端会在收到 offlineMode=true 时拒绝任何外部 API 调用;
   * proxyEnabled + proxyUrl 配合使用,保存后立即生效。
   */
  updateAppConfig: (input: {
    proxyEnabled?: boolean;
    proxyUrl?: string;
    offlineMode?: boolean;
  }) =>
    request<{ ok: boolean; message?: string }>('/settings/app', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /**
   * 拉取全局应用配置 - 后端权威(.env / 运行时覆盖的合并结果)
   * 供设置页进入时回填,确保前端 localStorage 与后端配置一致
   */
  getAppConfig: () =>
    request<{ proxyEnabled: boolean; proxyUrl: string; offlineMode: boolean }>('/settings/app'),

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