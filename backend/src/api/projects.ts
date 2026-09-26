/**
 * 项目路由 - /api/v1/projects
 *
 * POST   /                       创建项目
 * GET    /                       项目列表
 * GET    /search?q=...           FR-10 跨项目全文检索(name/description/keywords + 报告文本)
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

/**
 * FR-10: 跨项目全文检索
 * GET /projects/search?q=...&limit=...
 *
 * 匹配范围(OR 关系):
 *   - 项目元信息: name / description / keywords
 *   - 报告内容: summary / market_size / competitors[].name / competitors[].description
 *                / user_persona (任意键) / features (任意键)
 *
 * 返回结构:
 *   {
 *     hits: Array<{
 *       project: Project,
 *       matchedFields: string[],          // 命中了哪些字段,用于前端 highlight
 *       snippets: { field: '前后 40 字上下文' }
 *     }>,
 *     total: number
 *   }
 *
 * 实现说明:
 *   - 不在 SQLite 层做 FTS5,原因:report_data 是 JSON 文本,FTS 表达式配置代价大;
 *     项目体量个人版一般 < 5000 条,内存线性扫描已经 < 5ms。
 *   - 中文不分词,仅做子串匹配;满足“跨项目找一份提到某关键词的报告”的诉求。
 */
const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

interface SearchHit {
  project: ReturnType<typeof ProjectService.list>[number];
  matchedFields: string[];
  snippets: Record<string, string>;
}

/**
 * 从值集合中递归寻找是否含关键词,并产出截断上下文。
 * 上下文优先 30 字前后(尽量保证中文 30 字符内)。
 */
function collectSnippetsFromValue(
  value: unknown,
  q: string,
  fieldPrefix: string,
  out: Record<string, string>
): void {
  if (value == null) return;
  if (typeof value === 'string') {
    const idx = value.toLowerCase().indexOf(q.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(value.length, idx + q.length + 30);
      const snippet =
        (start > 0 ? '…' : '') + value.slice(start, end) + (end < value.length ? '…' : '');
      out[`${fieldPrefix}`] = snippet;
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => {
      collectSnippetsFromValue(item, q, `${fieldPrefix}.${i}`, out);
    });
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectSnippetsFromValue(v, q, `${fieldPrefix}.${k}`, out);
    }
  }
}

projectsRouter.get(
  '/search',
  asyncHandler<{ query: unknown }>((req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return fail(res, 400, parsed.error.message);
    }
    const { q, limit } = parsed.data;
    const ql = q.toLowerCase();

    // 1. 拉全量项目元信息 + 全量报告内容
    const projects = ProjectService.list(10000);
    const reports = ReportService.listAll();
    const reportMap = new Map(reports.map((r) => [r.project_id, r]));

    // 2. 对每个项目执行匹配
    const hits: SearchHit[] = [];
    for (const project of projects) {
      const matched = new Set<string>();
      const snippets: Record<string, string> = {};

      // (a) 项目元信息
      if (project.name && project.name.toLowerCase().includes(ql)) {
        matched.add('name');
        const idx = project.name.toLowerCase().indexOf(ql);
        snippets.name =
          (idx > 0 ? '…' : '') +
          project.name.slice(Math.max(0, idx - 30), Math.min(project.name.length, idx + q.length + 30)) +
          (idx + q.length < project.name.length ? '…' : '');
      }
      if (project.description && project.description.toLowerCase().includes(ql)) {
        matched.add('description');
        const idx = project.description.toLowerCase().indexOf(ql);
        snippets.description =
          (idx > 0 ? '…' : '') +
          project.description.slice(
            Math.max(0, idx - 30),
            Math.min(project.description.length, idx + q.length + 30)
          ) +
          (idx + q.length < project.description.length ? '…' : '');
      }
      if (project.keywords && project.keywords.some((k) => k.toLowerCase().includes(ql))) {
        matched.add('keywords');
        const hitKw = project.keywords.find((k) => k.toLowerCase().includes(ql));
        if (hitKw) snippets.keywords = hitKw;
      }

      // (b) 报告内容
      const report = reportMap.get(project.id);
      if (report && report.report_data) {
        const data = report.report_data as unknown as Record<string, unknown>;
        const reportSnippets: Record<string, string> = {};
        for (const key of ['summary', 'market_size', 'competitors', 'user_persona', 'features']) {
          if (key in data) {
            collectSnippetsFromValue(data[key], q, `report.${key}`, reportSnippets);
          }
        }
        for (const k of Object.keys(reportSnippets)) {
          matched.add(k);
          snippets[k] = reportSnippets[k]!;
        }
      }

      if (matched.size > 0) {
        hits.push({
          project,
          matchedFields: Array.from(matched),
          snippets,
        });
      }
    }

    // 3. 按命中字段数量降序,让最相关的在前
    hits.sort((a, b) => b.matchedFields.length - a.matchedFields.length);
    const truncated = hits.slice(0, limit);

    return ok(res, { hits: truncated, total: hits.length, q });
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