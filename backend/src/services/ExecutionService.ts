/**
 * 执行记录服务 - 跟踪调研过程的中间状态
 * 前端每 3s 轮询 /status 时返回最新步骤
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { Execution, ExecutionStatus } from '../types/index.js';

interface ExecutionRow {
  id: string;
  project_id: string;
  workflow_id: string | null;
  status: ExecutionStatus;
  current_step: string;
  logs: string;
  started_at: string;
  finished_at: string | null;
}

function rowToExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    project_id: row.project_id,
    workflow_id: row.workflow_id,
    status: row.status,
    current_step: row.current_step,
    logs: JSON.parse(row.logs) as Execution['logs'],
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

export const ExecutionService = {
  /** 创建执行记录 */
  create(projectId: string, workflowId = 'researchFlow'): Execution {
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO executions (id, project_id, workflow_id, status, current_step, logs)
       VALUES (?, ?, ?, 'running', '初始化', '[]')`
    ).run(id, projectId, workflowId);
    return this.getById(id)!;
  },

  /** 按 ID 获取 */
  getById(id: string): Execution | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM executions WHERE id = ?`).get(id) as
      | ExecutionRow
      | undefined;
    return row ? rowToExecution(row) : null;
  },

  /** 获取项目最新执行记录 */
  getLatestByProject(projectId: string): Execution | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT * FROM executions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(projectId) as ExecutionRow | undefined;
    return row ? rowToExecution(row) : null;
  },

  /** 追加日志条目 */
  appendLog(executionId: string, level: string, message: string): void {
    const db = getDb();
    const exec = this.getById(executionId);
    if (!exec) return;
    const logs = [
      ...exec.logs,
      { timestamp: new Date().toISOString(), level, message },
    ];
    db.prepare(`UPDATE executions SET logs = ? WHERE id = ?`).run(
      JSON.stringify(logs),
      executionId
    );
  },

  /** 更新当前步骤 */
  updateStep(executionId: string, step: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE executions SET current_step = ? WHERE id = ?`
    ).run(step, executionId);
  },

  /** 标记完成 */
  markFinished(executionId: string, status: ExecutionStatus): void {
    const db = getDb();
    db.prepare(
      `UPDATE executions SET status = ?, finished_at = datetime('now') WHERE id = ?`
    ).run(status, executionId);
  },
};