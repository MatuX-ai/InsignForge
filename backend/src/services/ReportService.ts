/**
 * 报告服务 - 报告的存取与查询
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { MarketReport, ProjectReport } from '../types/index.js';

export const ReportService = {
  /** 保存报告 */
  save(projectId: string, report: MarketReport): ProjectReport {
    const db = getDb();
    const id = randomUUID();
    const reportWithTs: MarketReport = { ...report, generated_at: new Date().toISOString() };

    // UPSERT:同一项目只保留最新一份
    db.prepare(
      `INSERT INTO project_reports (id, project_id, report_data) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         id = excluded.id,
         report_data = excluded.report_data,
         generated_at = excluded.generated_at`
    ).run(id, projectId, JSON.stringify(reportWithTs));

    return {
      id,
      project_id: projectId,
      report_data: reportWithTs,
      generated_at: reportWithTs.generated_at,
    };
  },

  /** 按项目 ID 获取报告 */
  getByProjectId(projectId: string): ProjectReport | null {
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM project_reports WHERE project_id = ?`)
      .get(projectId) as
      | { id: string; project_id: string; report_data: string; generated_at: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      project_id: row.project_id,
      report_data: JSON.parse(row.report_data) as MarketReport,
      generated_at: row.generated_at,
    };
  },
};