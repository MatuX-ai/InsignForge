/**
 * 项目路由 - /api/v1/projects
 *
 * POST   /             创建项目
 * GET    /             项目列表
 * GET    /:id          项目详情
 * PUT    /:id          更新项目
 * DELETE /:id          删除项目
 */
import { Router } from 'express';
import { z } from 'zod';
import { ProjectService } from '../services/ProjectService.js';
import { ReportService } from '../services/ReportService.js';
import { asyncHandler, ok, fail } from './response.js';

const createSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(5, '描述至少 5 个字符').max(2000),
});

export const projectsRouter = Router();

/** 创建项目 */
projectsRouter.post(
  '/',
  asyncHandler<{ body: unknown }>((req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 400, parsed.error.message);
    }
    const project = ProjectService.create(parsed.data);
    return ok(res, project, '项目创建成功');
  })
);

/** 项目列表 */
projectsRouter.get(
  '/',
  asyncHandler((_req, res) => {
    const projects = ProjectService.list();
    return ok(res, projects);
  })
);

/** 项目详情(包含报告) */
projectsRouter.get(
  '/:id',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    const report = ReportService.getByProjectId(project.id);
    return ok(res, { ...project, report: report?.report_data ?? null });
  })
);

/** 删除项目 */
projectsRouter.delete(
  '/:id',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const ok2 = ProjectService.delete(req.params.id);
    if (!ok2) return fail(res, 404, '项目不存在', 404);
    return ok(res, null, '项目已删除');
  })
);