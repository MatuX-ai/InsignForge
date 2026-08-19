/**
 * insightforge/session 服务 —— 文档 3.3 节
 *
 * 调研会话上下文管理,供其他插件跟踪进度。
 */
import type { InsightForgeCore } from '../core/researcher.js';
import type { ResearchDepth, ResearchSession } from '../types.js';

export interface SessionService {
  create(idea: string, depth?: ResearchDepth): ResearchSession;
  get(id: string): ResearchSession | undefined;
  list(): ResearchSession[];
  delete(id: string): boolean;
}

export function createSessionService(forge: InsightForgeCore): SessionService {
  return {
    create(idea, depth = 'standard') {
      return forge.createSession(idea, depth);
    },
    get(id) {
      return forge.getSession(id);
    },
    list() {
      // InsightForgeCore 内部维护 sessions Map,这里通过 getSession 暴露已存在的会话
      // 完整 list 能力需 InsightForgeCore 暴露 listSessions() — 当前为预留
      return [];
    },
    delete(id) {
      // InsightForgeCore 未暴露 delete,这里返回 false 表示当前实现不支持
      // 完整 CRUD 在 v1.0.0 实现
      void id;
      return false;
    },
  };
}