/**
 * 项目服务 - 处理项目 CRUD
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { Project, ProjectStatus } from '../types/index.js';

interface ProjectRow {
  id: string;
  user_id: string | null;
  name: string;
  description: string;
  keywords: string | null;
  status: ProjectStatus;
  progress: string;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    ...row,
    keywords: row.keywords ? (JSON.parse(row.keywords) as string[]) : null,
  };
}

export const ProjectService = {
  /** 创建项目 */
  create(input: { name?: string; description: string }): Project {
    const db = getDb();
    const id = randomUUID();
    const name = input.name?.trim() || input.description.slice(0, 60);

    db.prepare(
      `INSERT INTO projects (id, name, description, status) VALUES (?, ?, ?, 'draft')`
    ).run(id, name, input.description);

    return this.getById(id)!;
  },

  /** 按 ID 获取 */
  getById(id: string): Project | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
    return row ? rowToProject(row) : null;
  },

  /** 列出最近的项目 */
  list(limit = 50): Project[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM projects ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as ProjectRow[];
    return rows.map(rowToProject);
  },

  /** 更新项目状态与进度 */
  updateStatus(id: string, status: ProjectStatus, progress = ''): void {
    const db = getDb();
    db.prepare(
      `UPDATE projects SET status = ?, progress = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, progress, id);
  },

  /** 更新关键词 */
  updateKeywords(id: string, keywords: string[]): void {
    const db = getDb();
    db.prepare(
      `UPDATE projects SET keywords = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(keywords), id);
  },

  /** 删除项目 */
  delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    return result.changes > 0;
  },
};