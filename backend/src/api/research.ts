/**
 * 调研路由 - /api/v1/projects/:id/research
 *
 * POST /              触发调研
 * GET  /:projectId/status   轮询状态
 * GET  /:projectId/report   获取报告
 */
import { Router } from 'express';
import { triggerResearch } from '../services/ResearchService.js';
import { ExecutionService } from '../services/ExecutionService.js';
import { ReportService } from '../services/ReportService.js';
import { ProjectService } from '../services/ProjectService.js';
import { asyncHandler, ok, fail } from './response.js';

export const researchRouter = Router({ mergeParams: true });

/** 触发调研 */
researchRouter.post(
  '/',
  asyncHandler<{ params: { id: string } }>(async (req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);

    const execution = await triggerResearch(req.params.id);
    return ok(
      res,
      {
        execution_id: execution.id,
        status: execution.status,
        estimated_time: 180,
      },
      '调研已启动'
    );
  })
);

/** 获取调研状态(前端每 3s 轮询) */
researchRouter.get(
  '/status',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const execution = ExecutionService.getLatestByProject(req.params.id);
    if (!execution) return fail(res, 404, '尚未触发调研', 404);

    const project = ProjectService.getById(req.params.id);
    return ok(res, {
      project_id: req.params.id,
      status: project?.status ?? 'draft',
      progress: project?.progress ?? '',
      execution: {
        id: execution.id,
        status: execution.status,
        current_step: execution.current_step,
        started_at: execution.started_at,
        finished_at: execution.finished_at,
      },
    });
  })
);

/** 获取报告 */
researchRouter.get(
  '/report',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const report = ReportService.getByProjectId(req.params.id);
    if (!report) return fail(res, 404, '报告尚未生成', 404);
    return ok(res, report.report_data);
  })
);