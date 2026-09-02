/**
 * 执行记录服务 - 跟踪调研过程的中间状态
 * 前端每 3s 轮询 /status 时返回最新步骤
 *
 * vNext: 同时维护"调研过程实时指标"(各源条数 / 瀑布样本),
 *       仅存于 Execution.metrics 内存字段,进程重启即清空,
 *       前端在 analyzing 期间读出来渲染"数据瀑布"。
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type {
  Execution,
  ExecutionMetrics,
  ExecutionMetricBucket,
  ExecutionMetricSample,
  ExecutionStatus,
} from '../types/index.js';

/** 瀑布面板保留的样本上限(避免内存膨胀 + 减少网络传输) */
const MAX_SAMPLES = 30;

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

/**
 * 内存中的 metrics 缓存:execution_id -> ExecutionMetrics。
 * 与 error_code 字段一样,只存活在进程内,失败/重启即清空。
 * 进程内多 execution 并发时各自独立计数。
 */
const metricsCache = new Map<string, ExecutionMetrics>();

function ensureMetrics(id: string): ExecutionMetrics {
  let m = metricsCache.get(id);
  if (!m) {
    m = { buckets: [], samples: [] };
    metricsCache.set(id, m);
  }
  return m;
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
    if (!row) return null;
    const exec = rowToExecution(row);
    // 合并内存 metrics(进程内 only)
    const m = metricsCache.get(id);
    if (m) exec.metrics = m;
    return exec;
  },

  /** 获取项目最新执行记录 */
  getLatestByProject(projectId: string): Execution | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT * FROM executions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(projectId) as ExecutionRow | undefined;
    if (!row) return null;
    const exec = rowToExecution(row);
    const m = metricsCache.get(exec.id);
    if (m) exec.metrics = m;
    return exec;
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

  /** 设置业务错误码(仅内存态,不持久化) */
  setErrorCode(executionId: string, errorCode: Execution['error_code']): void {
    const exec = this.getById(executionId);
    if (exec) exec.error_code = errorCode;
  },

  // ---------- vNext: 调研过程实时指标 ----------

  /**
   * 批量追加采集到的样本(瀑布面板数据)。
   * 同一批样本按 source 合并写入 buckets,总量加到对应 bucket.count,
   * 样本列表按时间倒序保留最近 MAX_SAMPLES 条。
   * 设计要点:
   *   - 单次调用尽量一次性塞一批(减少排序/截断开销)
   *   - 入参是只读快照,不会被调用方再次持有
   */
  addMetricSamples(executionId: string, samples: ExecutionMetricSample[]): void {
    if (samples.length === 0) return;
    const metrics = ensureMetrics(executionId);
    const nowIso = new Date().toISOString();

    // 按 source 聚合本批新增的条数
    const added: Record<string, number> = {};
    for (const s of samples) {
      added[s.source] = (added[s.source] ?? 0) + 1;
    }

    // 更新 buckets(已存在则累加,不存在则追加)
    const bucketMap = new Map<string, ExecutionMetricBucket>();
    for (const b of metrics.buckets) bucketMap.set(b.source, b);
    for (const [source, count] of Object.entries(added)) {
      const existing = bucketMap.get(source);
      if (existing) {
        existing.count += count;
        existing.updated_at = nowIso;
      } else {
        bucketMap.set(source, {
          source,
          count,
          updated_at: nowIso,
        });
      }
    }
    metrics.buckets = Array.from(bucketMap.values()).sort((a, b) => b.count - a.count);

    // samples: 新批次整体插入队首,按 crawled_at 倒序截断
    const merged = [...samples, ...metrics.samples];
    merged.sort((a, b) => (a.crawled_at < b.crawled_at ? 1 : -1));
    metrics.samples = merged.slice(0, MAX_SAMPLES);
  },

  /** 读取 execution 的 metrics(供 status 接口序列化) */
  getMetrics(executionId: string): ExecutionMetrics | undefined {
    return metricsCache.get(executionId);
  },

  /** 调研结束时清理内存 metrics,防止后续轮询继续展示"瀑布" */
  clearMetrics(executionId: string): void {
    metricsCache.delete(executionId);
  },
};