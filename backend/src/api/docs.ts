/**
 * 开发文档路由 - /api/v1/projects/:id/docs
 *
 * POST /generate  触发异步生成 (立即返回 job)
 * GET  /status    轮询状态
 * GET  /download  下载 ZIP (success 时)
 *
 * 生成参数 (POST body):
 *   - version: 'mvp' | 'full' (默认 full)
 *   - use_tech_selection: boolean (默认 true)
 *   - use_frontend_design: boolean (默认 true)
 *   - business_model: string (可选,用于 MVP 版本)
 */
import { Router } from 'express';
import { DocService } from '../services/DocService.js';
import { ProjectService } from '../services/ProjectService.js';
import { asyncHandler, ok, fail } from './response.js';
import { reportFilenameBase } from '../utils/markdown.js';
import type { DocVersion } from '../agents/schemas/DocSchema.js';

export const docsRouter = Router({ mergeParams: true });

/**
 * POST /generate
 * 触发开发文档生成,立即返回 DocsJob
 * 同一项目若已在 running,直接复用现有 job
 */
docsRouter.post(
  '/generate',
  asyncHandler<{
    params: { id: string };
    body: {
      version?: DocVersion;
      use_tech_selection?: boolean;
      use_frontend_design?: boolean;
      business_model?: string;
    };
  }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (project.status !== 'completed') {
      return fail(res, 400, '请先完成市场调研后再生成开发文档');
    }

    const version = req.body?.version === 'mvp' ? 'mvp' : 'full';
    const job = DocService.trigger(req.params.id, {
      version,
      useTechSelection: req.body?.use_tech_selection !== false,
      useFrontendDesign: req.body?.use_frontend_design !== false,
      businessModel: req.body?.business_model,
    });
    return ok(res, jobToClient(job), '生成已启动');
  })
);

/**
 * GET /status
 * 返回最新 DocsJob (没有时返回 404)
 */
docsRouter.get(
  '/status',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const job = DocService.getStatus(req.params.id);
    if (!job) return fail(res, 404, '尚未生成开发文档', 404);
    return ok(res, jobToClient(job));
  })
);

/**
 * GET /download
 * 下载 ZIP (仅 success 时返回 200 + application/zip)
 */
docsRouter.get(
  '/download',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);

    const job = DocService.getStatus(req.params.id);
    if (!job) return fail(res, 404, '尚未生成开发文档,请先点击"生成开发文档"', 404);
    if (job.status === 'running') {
      return fail(res, 409, '开发文档仍在生成中,请稍候');
    }
    if (job.status === 'failed') {
      return fail(res, 500, `生成失败:${job.error_message ?? '未知错误'}`);
    }
    if (!job.zip) {
      return fail(res, 500, 'ZIP 数据丢失,请重新生成');
    }

    const base = reportFilenameBase(project);
    const versionLabel = job.version === 'mvp' ? 'MVP开发文档' : '开发文档';
    const zipBase = `${base}-${versionLabel}`;
    const encoded = encodeURIComponent(zipBase);
    const asciiFallback = `dev-docs-${job.version}-${project.id.slice(0, 8)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}.zip`
    );
    res.setHeader('Content-Length', job.zip.length.toString());
    res.end(job.zip);
  })
);

/**
 * 把内部 DocsJob 转为前端可消费的形状
 * (剥掉 zip Buffer,只暴露元数据)
 */
function jobToClient(job: ReturnType<typeof DocService.trigger>) {
  return {
    status: job.status,
    current_step: job.current_step,
    progress: job.progress,
    total: job.total,
    version: job.version,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error_code: job.error_code,
    error_message: job.error_message,
    filenames: job.filenames,
    /** 自动归档到"历史文档"目录后的绝对路径(供前端提示用户) */
    archive_path: job.archive_path ?? null,
  };
}
