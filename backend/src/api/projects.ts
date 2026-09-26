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
 * GET    /:id/export/insightforge  v1.8 P9-C 下载项目快照为 .insightforge (ZIP)
 * POST   /import/insightforge    v1.8 P9-C 从 .insightforge 创建新项目
 *                               (raw octet-stream,body 是 ZIP 字节流)
 */
import { Router } from 'express';
import { z } from 'zod';
import { ProjectService } from '../services/ProjectService.js';
import { ReportService } from '../services/ReportService.js';
import {
  buildPackageBuffer,
  parsePackageBuffer,
  importPackage,
  PackageParseError,
} from '../services/InsightforgePackageService.js';
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
  /** v1.7.1 P3: 市场热度 heat_score,用于复合排序的次级权重 */
  heatScore: number | null;
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
          heatScore: null,
        });
      }
    }

    // 3. v1.7.1 P3 增强: 复合排序 - 命中字段数(主) + 市场热度(次) + 创建时间(末)
    //   思路:
    //     - 命中字段数越多越相关,优先排在前
    //     - 同等命中下,市场热度(heat_score)越高的项目排前,避免老项目掩盖新发现
    //     - 热度也相同时,按创建时间倒序
    for (const h of hits) {
      const report = reportMap.get(h.project.id);
      const heat = (report?.report_data as unknown as { market_heat?: { heat_score?: number } })
        ?.market_heat?.heat_score;
      h.heatScore = typeof heat === 'number' ? heat : null;
    }
    hits.sort((a, b) => {
      const fieldDiff = b.matchedFields.length - a.matchedFields.length;
      if (fieldDiff !== 0) return fieldDiff;
      const heatDiff = (b.heatScore ?? -1) - (a.heatScore ?? -1);
      if (heatDiff !== 0) return heatDiff;
      // 末位:创建时间倒序(最新在前)
      return new Date(b.project.created_at).getTime() - new Date(a.project.created_at).getTime();
    });
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

/**
 * v1.8 P9-C: GET /:id/export/insightforge
 *
 * 把整个项目打包为 .insightforge(ZIP STORE)返回浏览器下载。
 * 与 export/markdown 单报告相比:.insightforge 包含项目元信息 + 报告 JSON +
 * 市场原始数据 + 讨论画布 + 执行记录,完全脱离 InsightForge 也能阅读(README +
 * report.md)和重新导入到任意 InsightForge 实例。
 *
 * 即便项目尚无报告,也允许导出(仅省略 report.json / report.md)。
 */
projectsRouter.get(
  '/:id/export/insightforge',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    let buf: Buffer;
    try {
      buf = buildPackageBuffer(project.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, projectId: project.id }, '生成 .insightforge 包失败');
      return fail(res, 500, `生成项目快照失败:${msg}`, 500);
    }
    const base = reportFilenameBase(project);
    const encoded = encodeURIComponent(base);
    const asciiFallback = `snapshot-${project.id.slice(0, 8)}.insightforge`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}.insightforge`
    );
    res.setHeader('Content-Length', buf.length.toString());
    res.end(buf);
  })
);

/**
 * v1.8 P9-C: POST /import/insightforge
 *
 * 上传一个 .insightforge 包,内部生成新的项目 ID 与关联 id,完成后返回新项目的元数据。
 *
 * Body 约定:
 *   - Content-Type: application/octet-stream 或 application/zip
 *   - Body: 完整 ZIP 字节流(上限 50MB,超出由 express.json / 默认 100kb 拦截,这里用 express.raw 突破)
 *   - 不依赖 multipart/form-data,避免引入 multer
 */
projectsRouter.post(
  '/import/insightforge',
  // express.raw 限制 50MB,只接受二进制 content-type;其它类型交给默认 json 解析
  // (express.raw 必须放在 asyncHandler 之前,这样 body 才已是 Buffer)
  expressRawZip,
  asyncHandler<{ body?: Buffer }>((req, res) => {
    const buf = req.body;
    if (!buf || !(buf instanceof Buffer) || buf.length === 0) {
      return fail(res, 400, '请求体为空,请上传有效的 .insightforge 文件');
    }
    if (buf.length > 50 * 1024 * 1024) {
      return fail(res, 413, '文件过大,上限 50MB');
    }
    let payload;
    try {
      payload = parsePackageBuffer(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof PackageParseError) {
        return fail(res, 400, `解析 .insightforge 失败:${msg}`, 400);
      }
      logger.error({ err: msg }, '导入 .insightforge 时解析失败');
      return fail(res, 500, `解析失败:${msg}`, 500);
    }
    let newProjectId: string;
    try {
      newProjectId = importPackage(payload, { namePrefix: '' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(res, 500, `导入失败:${msg}`, 500);
    }
    const newProject = ProjectService.getById(newProjectId);
    return ok(res, newProject, '项目已导入');
  })
);

/** 仅接受二进制 octet-stream / zip 的 express.raw 中间件 */
function expressRawZip(req: unknown, res: unknown, next: () => void) {
  // 通过 require 引入避免顶部的 import { json, raw } 体积膨胀
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const express = require('express');
  express.raw({ type: ['application/octet-stream', 'application/zip', 'application/x-zip-compressed'], limit: '50mb' })(
    req,
    res,
    next
  );
}