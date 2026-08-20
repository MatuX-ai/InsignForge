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
} from '../types';

const BASE = '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
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

  // ----- 落地页(预留) -----
  generateLanding: (projectId: string) =>
    request<{ placeholder: boolean; message: string }>(
      `/projects/${projectId}/landing`,
      { method: 'POST' }
    ),

  // ----- 需求库 -----
  searchNeeds: (keyword: string) =>
    request(`/market-needs?keyword=${encodeURIComponent(keyword)}`),

  // ----- 设置 -----
  getLlmStatus: () => request<LlmStatus>('/settings/llm'),

  updateLlmApiKey: (apiKey: string) =>
    request<{ ok: boolean; message?: string }>('/settings/llm/api-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),
};