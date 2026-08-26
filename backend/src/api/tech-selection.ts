/**
 * 技术选型路由 - /api/v1/projects/:id/tech-selection
 *
 * POST /generate  触发技术选型分析 (异步)
 * GET  /status    轮询状态
 * POST /select    用户确认选择某套方案
 */
import { Router } from 'express';
import { TechSelectionService } from '../services/TechSelectionService.js';
import { ProjectService } from '../services/ProjectService.js';
import { asyncHandler, ok, fail } from './response.js';

export const techSelectionRouter = Router({ mergeParams: true });

/** POST /generate - 触发技术选型分析 */
techSelectionRouter.post(
  '/generate',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (project.status !== 'completed') {
      return fail(res, 400, '请先完成市场调研后再进行技术选型');
    }

    const job = TechSelectionService.trigger(req.params.id);
    return ok(res, jobToClient(job), '技术选型分析已启动');
  })
);

/** GET /status - 查询状态 */
techSelectionRouter.get(
  '/status',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const job = TechSelectionService.getStatus(req.params.id);
    if (!job) return fail(res, 404, '尚未进行技术选型分析', 404);
    return ok(res, jobToClient(job));
  })
);

/** POST /select - 用户确认选择方案 */
techSelectionRouter.post(
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

    const selected = TechSelectionService.selectPlan(req.params.id, planId);
    if (!selected) {
      return fail(res, 400, '技术选型尚未完成或方案不存在,请先生成选型方案');
    }
    return ok(res, { selected_plan: selected }, '方案已确认');
  })
);

/** 把内部 job 转为前端可消费的形状 */
function jobToClient(job: ReturnType<typeof TechSelectionService.trigger>) {
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
