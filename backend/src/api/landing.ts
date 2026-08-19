/**
 * 验证落地页路由(预留接口,Phase 1 占位)
 * POST /api/v1/projects/:id/landing
 *
 * 实际生成由 DeepSeek Harness 负责,本 MVP 阶段不实现
 */
import { Router } from 'express';
import { ProjectService } from '../services/ProjectService.js';
import { asyncHandler, ok, fail } from './response.js';

export const landingRouter = Router({ mergeParams: true });

landingRouter.post(
  '/',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (project.status !== 'completed') {
      return fail(res, 400, '请先完成市场调研');
    }
    return ok(
      res,
      {
        placeholder: true,
        message:
          '落地页生成功能将在 v1.1 接入 DeepSeek Harness 后启用。本 MVP 阶段先做接口占位。',
        project_id: project.id,
      },
      '接口已就绪(占位)'
    );
  })
);