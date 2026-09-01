/**
 * 商业计划书生成服务
 *
 * 职责:
 *   1. 基于已生成的市场报告,调用 LLM 生成 12 份商业计划书文档
 *   2. 把 12 份 md 文本落盘到"历史文档"目录下的项目子目录
 *      (不再打包成 ZIP,便于桌面端直接打开预览)
 *   3. 在内存中维护生成状态 (running / success / failed),供前端轮询
 *
 * 状态存储策略:
 *   - 按 projectId 维护,使用 Map
 *   - 进程重启后状态丢失 (符合 MVP 场景,用户重新生成即可)
 *   - 不入库是为了避免在 v1.0 阶段扩展数据库 schema
 *
 * 复用调研的"异步触发 + 状态轮询"模式,与 DocService 一致
 */
import { chatJsonWithSchemaRetry } from './llm/LLMClient.js';
import { ProjectService } from './ProjectService.js';
import { ReportService } from './ReportService.js';
import { logger } from '../logger.js';
import {
  BP_GENERATION_SYSTEM,
  buildBpGenerationUserPrompt,
} from '../agents/prompts/businessPlanGenerator.js';
import {
  BpResponseSchema,
  BP_FILENAMES,
  type ValidatedBpResponse,
} from '../agents/schemas/BusinessPlanSchema.js';
import { saveMdsToHistoryDoc } from '../utils/archive.js';

/** 单个项目的商业计划书生成状态 */
export interface BpJob {
  status: 'running' | 'success' | 'failed';
  /** 人类可读的当前步骤,前端可轮询展示 */
  current_step: string;
  /** 已完成的文档数 (可选,前端可展示进度) */
  progress: number;
  /** 总文档数 (= 12) */
  total: number;
  started_at: string;
  finished_at: string | null;
  error_code: 'MISSING_API_KEY' | 'INTERNAL_ERROR' | null;
  error_message: string | null;
  /** 已写入的文件名列表(顺序与 BP_FILENAMES 一致) */
  filenames: string[];
  /** 自动归档到"历史文档"目录后的绝对路径(指向 md 所在目录,未归档为 null) */
  archive_path: string | null;
}

/** 模块级 Map: projectId -> BpJob */
const jobs = new Map<string, BpJob>();

const TOTAL = BP_FILENAMES.length;

function newRunningJob(): BpJob {
  return {
    status: 'running',
    current_step: '正在调用 AI 生成商业计划书...',
    progress: 0,
    total: TOTAL,
    started_at: new Date().toISOString(),
    finished_at: null,
    error_code: null,
    error_message: null,
    filenames: [],
    archive_path: null,
  };
}

export const BusinessPlanService = {
  /**
   * 触发生成 - 立即返回 job,后台异步执行
   * 若该项目正在生成中,直接复用现有 job,避免重复调用 LLM
   */
  trigger(projectId: string): BpJob {
    const existing = jobs.get(projectId);
    if (existing && existing.status === 'running') {
      return existing;
    }
    const job = newRunningJob();
    jobs.set(projectId, job);
    void runBp(projectId, job).catch((err) => {
      logger.error({ err, projectId }, '生成商业计划书未捕获异常');
    });
    return job;
  },

  /** 获取状态(若不存在则返回 null,不自动创建) */
  getStatus(projectId: string): BpJob | null {
    return jobs.get(projectId) ?? null;
  },

  /** 重置(前端"重新生成"按钮使用) */
  reset(projectId: string): void {
    jobs.delete(projectId);
  },
};

/**
 * 后台执行:校验报告 -> 调用 LLM -> 校验 schema -> 写盘归档 -> 更新状态
 */
async function runBp(projectId: string, job: BpJob): Promise<void> {
  try {
    // ---------- 0. 校验前提:项目 + 报告都存在 ----------
    const project = ProjectService.getById(projectId);
    if (!project) throw new Error('项目不存在');

    const reportRecord = ReportService.getByProjectId(projectId);
    if (!reportRecord) {
      throw new Error('报告尚未生成,请先完成市场调研');
    }

    job.current_step = `正在基于 ${TOTAL} 份模板生成商业计划书...`;
    job.progress = 1;

    // ---------- 1. 调用 LLM 生成结构化 JSON ----------
    // 单次调用同时生成 12 份文档;maxTokens 必须够大,12 份 ~24K token
    const reportJson = JSON.stringify(reportRecord.report_data, null, 2);
    const bp = await chatJsonWithSchemaRetry<ValidatedBpResponse>(
      BP_GENERATION_SYSTEM,
      buildBpGenerationUserPrompt(
        project.description,
        reportJson,
        project.name
      ),
      BpResponseSchema,
      {
        schemaName: 'BusinessPlanResponse',
        temperature: 0.4,
        maxTokens: 24000,
      }
    );

    job.progress = TOTAL;
    job.current_step = '正在落盘文档...';

    // ---------- 2. 校验文件名覆盖度 ----------
    const produced = new Set(bp.documents.map((d) => d.filename));
    const missing = BP_FILENAMES.filter((f) => !produced.has(f));
    if (missing.length > 0) {
      logger.warn(
        { projectId, missing, produced: [...produced] },
        'LLM 未生成全部 12 份商业计划书文档,缺失部分将用占位补齐'
      );
    }

    // ---------- 3. 按 BP_FILENAMES 顺序整理 + 缺失补占位 ----------
    const entries = BP_FILENAMES.map((filename) => {
      const found = bp.documents.find((d) => d.filename === filename);
      if (found) {
        return { filename, content: found.content };
      }
      // 缺失占位,避免目录里出现空文件
      return {
        filename,
        content: buildPlaceholder(filename),
      };
    });

    // ---------- 4. 落盘到"历史文档"目录下的项目子目录 ----------
    let archiveDir: string | null = null;
    let writtenFilenames: string[] = [];
    try {
      const result = saveMdsToHistoryDoc({
        projectName: project.name,
        category: '商业计划书',
        entries,
      });
      archiveDir = result.dir;
      writtenFilenames = result.filenames;
    } catch (err) {
      logger.error(
        { err, projectId },
        '商业计划书自动归档到历史文档失败(不影响生成结果)'
      );
    }

    // ---------- 5. 更新 job 状态 ----------
    job.filenames = writtenFilenames;
    job.archive_path = archiveDir;
    job.status = 'success';
    job.current_step = '生成完成';
    job.finished_at = new Date().toISOString();
    logger.info(
      { projectId, files: job.filenames.length, dir: archiveDir },
      '商业计划书生成完成'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error_message = msg;
    job.finished_at = new Date().toISOString();
    // 识别业务错误码(MISSING_API_KEY)
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : null;
    if (code === 'MISSING_API_KEY') {
      job.error_code = 'MISSING_API_KEY';
    } else {
      job.error_code = 'INTERNAL_ERROR';
    }
    job.current_step = `失败:${msg}`;
    logger.error({ err: msg, projectId }, '商业计划书生成失败');
  }
}

/** 单份缺失文档的占位内容 */
function buildPlaceholder(filename: string): string {
  return `# ${filename}

> ⚠️ 本次生成未能覆盖此文档。AI 输出可能因 token 限制被截断,或文件名与预期不符。

## 建议处理

1. 在前端点击"重新生成"再试一次
2. 若多次重试仍缺失,可手动补充此文档
3. 检查后端日志,搜索 "商业计划书结构校验失败" 获取原始 LLM 输出

---

_本占位由 InsightForge BusinessPlanService 自动补齐_
`;
}