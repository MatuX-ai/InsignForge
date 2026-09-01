/**
 * 商业计划书路由 - /api/v1/projects/:id/business-plan
 *
 * POST /generate  触发异步生成 (立即返回 job)
 * GET  /status    轮询状态
 *
 * 商业计划书的产物现在直接落到"历史文档"目录下的项目子目录,
 * 由桌面端主进程通过 IPC 提供"另存"交互;不再走 HTTP 流式下载。
 */
import { Router } from 'express';
import { BusinessPlanService } from '../services/BusinessPlanService.js';
import { ProjectService } from '../services/ProjectService.js';
import { asyncHandler, ok, fail } from './response.js';

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
 * 把内部 BpJob 转为前端可消费的形状
 * (透传 archive_path 即 md 所在目录绝对路径)
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
    /** 自动归档目录的绝对路径(指向 12 份 md 所在的文件夹),供桌面端"另存"与自动预览使用 */
    archive_path: job.archive_path ?? null,
  };
}