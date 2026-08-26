/**
 * 前端设计方案路由 - /api/v1/projects/:id/frontend-design
 *
 * POST /generate  触发生成 (异步)
 * GET  /status    轮询状态
 * POST /select    用户确认选择某套方案
 */
import { Router } from 'express';
import { FrontendDesignService } from '../services/FrontendDesignService.js';
import { ProjectService } from '../services/ProjectService.js';
import { asyncHandler, ok, fail } from './response.js';

export const frontendDesignRouter = Router({ mergeParams: true });

/** POST /generate - 触发前端设计方案生成 */
frontendDesignRouter.post(
  '/generate',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (project.status !== 'completed') {
      return fail(res, 400, '请先完成市场调研后再生成前端设计方案');
    }

    const job = FrontendDesignService.trigger(req.params.id);
    return ok(res, jobToClient(job), '前端设计方案生成已启动');
  })
);

/** GET /status - 查询状态 */
frontendDesignRouter.get(
  '/status',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const job = FrontendDesignService.getStatus(req.params.id);
    if (!job) return fail(res, 404, '尚未生成前端设计方案', 404);
    return ok(res, jobToClient(job));
  })
);

/** POST /select - 用户确认选择方案 */
frontendDesignRouter.post(
  '/select',
  asyncHandler<{
    params: { id: string };
    body: { plan_id: 'plan_a' | 'plan_b' | 'plan_c' };
  }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);

    const planId = req.body?.plan_id;
    if (!planId || !['plan_a', 'plan_b', 'plan_c'].includes(planId)) {
      return fail(res, 400, 'plan_id 参数无效,应为 plan_a / plan_b / plan_c');
    }

    const selected = FrontendDesignService.selectPlan(req.params.id, planId);
    if (!selected) {
      return fail(res, 400, '前端设计方案尚未生成或方案不存在');
    }
    return ok(res, { selected_plan: selected }, '方案已确认');
  })
);

function jobToClient(job: ReturnType<typeof FrontendDesignService.trigger>) {
  return {
    status: job.status,
    current_step: job.current_step,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error_code: job.error_code,
    error_message: job.error_message,
    result: job.result,
    selected_plan: job.selected_plan,
  };
}
