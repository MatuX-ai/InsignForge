/**
 * 项目路由 - /api/v1/projects
 *
 * POST   /                       创建项目
 * GET    /                       项目列表
 * GET    /:id                    项目详情
 * DELETE /:id                    删除项目
 * GET    /:id/export/markdown    下载报告为 Markdown
 * GET    /:id/export/pdf         下载报告为 PDF (后端 puppeteer-core)
 */
import { Router } from 'express';
import { z } from 'zod';
import { ProjectService } from '../services/ProjectService.js';
import { ReportService } from '../services/ReportService.js';
import { asyncHandler, ok, fail } from './response.js';
import { reportToMarkdown, reportFilenameBase } from '../utils/markdown.js';
import { generateReportPdf, ChromiumNotFoundError } from '../utils/pdf.js';
import { logger } from '../logger.js';

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

/**
 * 辅助函数:取报告 (同时校验项目存在)
 * 找不到项目 → 404, 找到项目但报告未生成 → 404
 */
function loadReport(
  id: string
): { project: ReturnType<typeof ProjectService.getById>; report: ReturnType<typeof ReportService.getByProjectId> } {
  const project = ProjectService.getById(id);
  if (!project) return { project, report: null };
  const report = ReportService.getByProjectId(id);
  return { project, report };
}

/**
 * GET /:id/export/markdown
 * 返回 Markdown 文件下载,Content-Disposition 让浏览器直接保存
 */
projectsRouter.get(
  '/:id/export/markdown',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const { project, report } = loadReport(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (!report) return fail(res, 404, '报告尚未生成', 404);

    const md = reportToMarkdown(project, report.report_data);
    const base = reportFilenameBase(project);

    // 防止中文文件名在响应头中被错误编码,使用 RFC 5987 兼容写法
    // Node.js setHeader 拒绝非 ASCII 字符,所以 plain filename 用 ID 拼 ASCII 兜底
    const encoded = encodeURIComponent(base);
    const asciiFallback = `report-${project.id.slice(0, 8)}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}.md`
    );
    res.send(md);
  })
);

/**
 * GET /:id/export/pdf
 * 使用 puppeteer-core + 系统 Chromium 渲染 PDF
 * 找不到 Chromium 时返回 503,前端可降级到 window.print()
 */
projectsRouter.get(
  '/:id/export/pdf',
  asyncHandler<{ params: { id: string } }>(async (req, res) => {
    const { project, report } = loadReport(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (!report) return fail(res, 404, '报告尚未生成', 404);

    try {
      const buffer = await generateReportPdf(project, report.report_data);
      const base = reportFilenameBase(project);
      const encoded = encodeURIComponent(base);
      // Node.js setHeader 拒绝非 ASCII 字符,所以 plain filename 用 ID 拼 ASCII 兜底
      const asciiFallback = `report-${project.id.slice(0, 8)}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}.pdf`
      );
      res.setHeader('Content-Length', buffer.length.toString());
      res.end(buffer);
    } catch (err) {
      if (err instanceof ChromiumNotFoundError) {
        // 去掉前缀,只用可读消息体
        const userMsg = err.message.replace(/^CHROMIUM_NOT_FOUND:\s*/, '');
        return fail(
          res,
          503,
          `${userMsg}。前端可降级为浏览器打印 (window.print(),然后"另存为 PDF")`,
          503
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, 'PDF 生成失败');
      return fail(res, 500, `PDF 生成失败:${msg}`, 500);
    }
  })
);