/**
 * 开发文档生成服务
 *
 * 职责:
 *   1. 基于已生成的市场报告,调用 LLM 生成开发文档
 *   2. 支持两种版本: mvp (8份精简) / full (10份完整)
 *   3. 可注入用户已选的技术栈方案和前端设计方案
 *   4. 把多份 md 文件打包为 ZIP Buffer
 *   5. 在内存中维护生成状态 (running / success / failed),供前端轮询
 *
 * 状态存储策略:
 *   - 按 projectId + version 维护,使用 Map
 *   - 进程重启后状态丢失 (符合 MVP 场景)
 */
import { chatJson } from './llm/LLMClient.js';
import { ProjectService } from './ProjectService.js';
import { ReportService } from './ReportService.js';
import { TechSelectionService } from './TechSelectionService.js';
import { FrontendDesignService } from './FrontendDesignService.js';
import { logger } from '../logger.js';
import {
  DOC_GENERATION_SYSTEM_FULL,
  DOC_GENERATION_SYSTEM_MVP,
  buildDocGenerationUserPrompt,
} from '../agents/prompts/docGenerator.js';
import {
  DocsResponseSchema,
  getDocFilenames,
  type DocVersion,
  type ValidatedDocsResponse,
} from '../agents/schemas/DocSchema.js';
import { createZipBuffer, type ZipEntry } from '../utils/zip.js';
import { saveZipToHistoryDoc } from '../utils/archive.js';

/** 触发生成的参数 */
export interface TriggerDocsOptions {
  version?: DocVersion;
  /** 是否使用已选的技术栈方案 (默认 true) */
  useTechSelection?: boolean;
  /** 是否使用已选的前端设计方案 (默认 true) */
  useFrontendDesign?: boolean;
  /** 商业模式描述 (用于 MVP 版本) */
  businessModel?: string;
}

/** 单个项目的文档生成状态 */
export interface DocsJob {
  status: 'running' | 'success' | 'failed';
  /** 人类可读的当前步骤,前端可轮询展示 */
  current_step: string;
  /** 已完成的文档数 */
  progress: number;
  /** 总文档数 (MVP=8, Full=10) */
  total: number;
  /** 文档版本 */
  version: DocVersion;
  started_at: string;
  finished_at: string | null;
  error_code: 'MISSING_API_KEY' | 'INTERNAL_ERROR' | null;
  error_message: string | null;
  /** 生成完成后的 ZIP Buffer */
  zip: Buffer | null;
  /** ZIP 内文件名列表 */
  filenames: string[];
  /** 自动归档到"历史文档"目录后的绝对路径(未归档为 null) */
  archive_path: string | null;
}

/** 模块级 Map: projectId -> DocsJob (每个项目只保留一个版本的 job,新版本覆盖旧版本) */
const jobs = new Map<string, DocsJob>();

function newRunningJob(version: DocVersion): DocsJob {
  const total = getDocFilenames(version).length;
  return {
    status: 'running',
    current_step: '正在调用 AI 生成开发文档...',
    progress: 0,
    total,
    version,
    started_at: new Date().toISOString(),
    finished_at: null,
    error_code: null,
    error_message: null,
    zip: null,
    filenames: [],
    archive_path: null,
  };
}

export const DocService = {
  /**
   * 触发生成 - 立即返回 job,后台异步执行
   * 若该项目正在生成中,直接复用现有 job
   */
  trigger(projectId: string, options: TriggerDocsOptions = {}): DocsJob {
    const version = options.version ?? 'full';
    const existing = jobs.get(projectId);
    if (existing && existing.status === 'running') {
      return existing;
    }
    const job = newRunningJob(version);
    jobs.set(projectId, job);
    void runDocs(projectId, job, options).catch((err) => {
      logger.error({ err, projectId, version }, '生成开发文档未捕获异常');
    });
    return job;
  },

  /** 获取状态(若不存在则返回 null) */
  getStatus(projectId: string): DocsJob | null {
    return jobs.get(projectId) ?? null;
  },

  /** 获取 ZIP(若未成功则返回 null) */
  getZip(projectId: string): Buffer | null {
    const job = jobs.get(projectId);
    return job?.status === 'success' ? job.zip : null;
  },

  /** 重置 */
  reset(projectId: string): void {
    jobs.delete(projectId);
  },
};

/**
 * 后台执行:校验报告 -> 收集选型结果 -> 调用 LLM -> 校验 schema -> 打包 ZIP -> 更新状态
 */
async function runDocs(
  projectId: string,
  job: DocsJob,
  options: TriggerDocsOptions
): Promise<void> {
  try {
    const version = options.version ?? 'full';
    const useTech = options.useTechSelection !== false;
    const useDesign = options.useFrontendDesign !== false;

    // ---------- 0. 校验前提:项目 + 报告都存在 ----------
    const project = ProjectService.getById(projectId);
    if (!project) throw new Error('项目不存在');

    const reportRecord = ReportService.getByProjectId(projectId);
    if (!reportRecord) {
      throw new Error('报告尚未生成,请先完成市场调研');
    }

    const total = getDocFilenames(version).length;
    job.current_step = `正在基于 ${total} 份模板生成${version === 'mvp' ? 'MVP' : '完整'}开发文档...`;
    job.progress = 1;

    // ---------- 1. 收集已选的技术栈和设计方案 ----------
    let techStackJson: string | undefined;
    let frontendDesignJson: string | undefined;

    if (useTech) {
      const selected = TechSelectionService.getSelectedPlan(projectId);
      if (selected) {
        techStackJson = JSON.stringify(selected, null, 2);
        logger.info({ projectId }, '使用用户已选技术栈方案生成文档');
      }
    }

    if (useDesign) {
      const selected = FrontendDesignService.getSelectedPlan(projectId);
      if (selected) {
        frontendDesignJson = JSON.stringify(selected, null, 2);
        logger.info({ projectId }, '使用用户已选前端设计方案生成文档');
      }
    }

    // ---------- 2. 调用 LLM 生成结构化 JSON ----------
    const reportJson = JSON.stringify(reportRecord.report_data, null, 2);
    const systemPrompt =
      version === 'mvp'
        ? DOC_GENERATION_SYSTEM_MVP
        : DOC_GENERATION_SYSTEM_FULL;
    const maxTokens = version === 'mvp' ? 15000 : 20000;

    const raw = await chatJson<unknown>(
      systemPrompt,
      buildDocGenerationUserPrompt(
        project.description,
        reportJson,
        project.name,
        version,
        techStackJson,
        frontendDesignJson,
        options.businessModel
      ),
      { temperature: 0.4, maxTokens }
    );

    // ---------- 3. schema 校验 ----------
    const parsed = DocsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { err: parsed.error.format(), raw },
        '开发文档结构校验失败'
      );
      throw new Error(
        `LLM 返回的开发文档结构不符合预期:${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
    }

    const docs: ValidatedDocsResponse = parsed.data;
    job.progress = total;
    job.current_step = '正在打包文档...';

    // ---------- 4. 校验文件名覆盖度 ----------
    const expectedFilenames = getDocFilenames(version);
    const produced = new Set(docs.documents.map((d) => d.filename));
    const missing = expectedFilenames.filter((f) => !produced.has(f));
    if (missing.length > 0) {
      logger.warn(
        { projectId, missing, produced: [...produced] },
        'LLM 未生成全部文档,缺失部分将用占位补齐'
      );
    }

    // ---------- 5. 按顺序整理 + 缺失补占位 ----------
    const entries: ZipEntry[] = expectedFilenames.map((filename) => {
      const found = docs.documents.find((d) => d.filename === filename);
      if (found) {
        return { path: filename, content: found.content };
      }
      return {
        path: filename,
        content: buildPlaceholder(filename, version),
      };
    });

    // ---------- 6. 打包 ZIP ----------
    const zip = createZipBuffer(entries);

    // ---------- 7. 自动归档到"历史文档"目录(重启后文件仍在) ----------
    let archivePath: string | null = null;
    try {
      archivePath = saveZipToHistoryDoc({
        projectName: project.name,
        category: version === 'mvp' ? '开发文档-MVP' : '开发文档',
        zip,
      });
    } catch (err) {
      logger.error({ err, projectId }, '开发文档自动归档到历史文档失败(不影响下载)');
    }

    // ---------- 8. 更新 job 状态 ----------
    job.filenames = entries.map((e) => e.path);
    job.zip = zip;
    job.archive_path = archivePath;
    job.status = 'success';
    job.current_step = '生成完成';
    job.finished_at = new Date().toISOString();
    logger.info(
      { projectId, version, files: job.filenames.length, bytes: zip.length },
      '开发文档生成完成'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error_message = msg;
    job.finished_at = new Date().toISOString();
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
    logger.error({ err: msg, projectId }, '开发文档生成失败');
  }
}

/** 单份缺失文档的占位内容 */
function buildPlaceholder(filename: string, version: DocVersion): string {
  return `# ${filename}

> ⚠️ 本次生成未能覆盖此文档。AI 输出可能因 token 限制被截断,或文件名与预期不符。

## 建议处理

1. 在前端点击"重新生成"再试一次
2. 若多次重试仍缺失,可手动补充此文档
3. 检查后端日志,搜索 "开发文档结构校验失败" 获取原始 LLM 输出

---

_本占位由 InsightForge DocService 自动补齐 (${version === 'mvp' ? 'MVP 版' : '完整版'})_
`;
}
