/**
 * API 客户端封装
 * 基础路径 /api/v1,所有响应统一为 { code, message, data }
 */
import type { ApiResponse, Project, MarketReport, ResearchStatus, TriggerResearchResponse } from '../types';

const BASE = '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
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
};