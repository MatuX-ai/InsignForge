/**
 * 商业计划书路由 - /api/v1/projects/:id/business-plan
 *
 * POST /generate  触发异步生成 (立即返回 job)
 * GET  /status    轮询状态
 * GET  /download  下载 ZIP (success 时)
 */
import { Router } from 'express';
import { BusinessPlanService } from '../services/BusinessPlanService.js';
import { ProjectService } from '../services/ProjectService.js';
import { asyncHandler, ok, fail } from './response.js';
import { reportFilenameBase } from '../utils/markdown.js';

export const businessPlanRouter = Router({ mergeParams: true });

/**
 * POST /generate
 * 触发商业计划书生成,立即返回 BpJob (前端轮询 status 直到 success/failed)
 * 同一项目若已在 running,直接复用现有 job,避免重复 LLM 调用
 */
businessPlanRouter.post(
  '/generate',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (project.status !== 'completed') {
      return fail(res, 400, '请先完成市场调研后再生成商业计划书');
    }

    const job = BusinessPlanService.trigger(req.params.id);
    return ok(res, jobToClient(job), '生成已启动');
  })
);

/**
 * GET /status
 * 返回最新 BpJob (没有时返回 404,提示前端先点击生成)
 */
businessPlanRouter.get(
  '/status',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const job = BusinessPlanService.getStatus(req.params.id);
    if (!job) return fail(res, 404, '尚未生成商业计划书', 404);
    return ok(res, jobToClient(job));
  })
);

/**
 * GET /download
 * 下载 ZIP (仅 success 时返回 200 + application/zip)
 * 失败/未生成时返回 4xx 错误
 */
businessPlanRouter.get(
  '/download',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);

    const job = BusinessPlanService.getStatus(req.params.id);
    if (!job) return fail(res, 404, '尚未生成商业计划书,请先点击"生成商业计划书"', 404);
    if (job.status === 'running') {
      return fail(res, 409, '商业计划书仍在生成中,请稍候');
    }
    if (job.status === 'failed') {
      return fail(res, 500, `生成失败:${job.error_message ?? '未知错误'}`);
    }
    if (!job.zip) {
      return fail(res, 500, 'ZIP 数据丢失,请重新生成');
    }

    const base = reportFilenameBase(project);
    // 文件名: {项目名}-商业计划书.zip
    const zipBase = `${base}-商业计划书`;
    const encoded = encodeURIComponent(zipBase);
    // Node.js setHeader 拒绝非 ASCII 字符。plain filename 用项目 ID 拼 ASCII 兜底,
    // 真实中文文件名走 RFC 5987 filename*=UTF-8'' 部分
    const asciiFallback = `business-plan-${project.id.slice(0, 8)}.zip`;
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
 * 把内部 BpJob 转为前端可消费的形状
 * (剥掉 zip Buffer,只暴露元数据)
 */
function jobToClient(job: ReturnType<typeof BusinessPlanService.trigger>) {
  return {
    status: job.status,
    current_step: job.current_step,
    progress: job.progress,
    total: job.total,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error_code: job.error_code,
    error_message: job.error_message,
    filenames: job.filenames,
    /** 自动归档到"历史文档"目录后的绝对路径(供前端提示用户) */
    archive_path: job.archive_path ?? null,
  };
}
