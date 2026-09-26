/**
 * 验证落地页路由
 * POST /api/v1/projects/:id/landing
 *
 * 基于市场报告数据自动生成验证落地页 HTML
 *
 * v1.7.1 增强 (FR-13):
 *   - 调用 plugin host (./plugins/host.ts) 而不是直接 generateLanding
 *   - 当前内置 builtin-landing 插件为兜底实现
 *   - 后续接入 dsh / 第三方生成器时,在 plugins/host.ts 注册即可
 *
 * v1.7.1 增强 (FR-14):
 *   - 请求体支持可选的 cta / subtext / success_message / form_fields
 *   - 智能 CTA 推荐(根据 idea / value_proposition 关键词)
 *   - 表单字段可自定义(默认仅 email)
 */
import { z } from 'zod';
import { Router } from 'express';
import { ProjectService } from '../services/ProjectService.js';
import { ReportService } from '../services/ReportService.js';
import { asyncHandler, ok, fail } from './response.js';
import { invokeLandingGenerator } from '../plugins/host.js';

const landingFormFieldSchema = z.object({
  name: z.string().min(1).max(40),
  type: z.enum(['email', 'phone', 'text']),
  label: z.string().min(1).max(40),
  placeholder: z.string().max(80).optional(),
  required: z.boolean().optional().default(true),
});

const landingRequestSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  call_to_action: z.string().min(1).max(40).optional(),
  call_to_action_subtext: z.string().max(120).optional(),
  success_message: z.string().min(1).max(40).optional(),
  form_fields: z.array(landingFormFieldSchema).min(1).max(5).optional(),
});

export const landingRouter = Router({ mergeParams: true });

landingRouter.post(
  '/',
  asyncHandler<{ params: { id: string }; body: unknown }>(async (req, res) => {
    const project = ProjectService.getById(req.params.id);
    if (!project) return fail(res, 404, '项目不存在', 404);
    if (project.status !== 'completed') {
      return fail(res, 400, '请先完成市场调研');
    }

    const reportRecord = ReportService.getByProjectId(req.params.id);
    if (!reportRecord) {
      return fail(res, 404, '报告尚未生成', 404);
    }

    const report = reportRecord.report_data;

    // 从报告中提取价值主张和副标题
    const valueProposition = buildValueProposition(project, report);
    const tagline = buildTagline(report);

    // FR-14: 校验请求体(可选配置)
    const parsed = landingRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return fail(res, 400, parsed.error.message);
    }
    const overrides = parsed.data;

    // FR-13: 通过 plugin host 调用,失败会自动降级到下一个可用插件
    const result = await invokeLandingGenerator(
      {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
        },
        report: {
          summary: report.summary,
          market_size: report.market_size,
          pain_points: report.pain_points,
          opportunities: report.opportunities,
          market_heat: report.market_heat,
        },
        formFieldsOverride: overrides.form_fields,
      },
      {
        idea: project.name,
        value_proposition: valueProposition,
        // FR-14: 不再传固定 call_to_action,交给生成器根据 idea / vp 智能推荐
        call_to_action: overrides.call_to_action,
        call_to_action_subtext: overrides.call_to_action_subtext,
        success_message: overrides.success_message,
        form_fields: overrides.form_fields,
        theme: overrides.theme ?? 'light',
        tagline,
      }
    );

    return ok(
      res,
      {
        html: result.html,
        size: result.size,
        theme: result.theme,
        filename: `${project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'landing'}-落地页.html`,
      },
      '落地页生成成功'
    );
  })
);

/**
 * 基于报告数据构建价值主张
 * 优先使用执行摘要,其次用市场规模描述
 */
function buildValueProposition(project: { name: string; description: string }, report: { summary: string; market_size: string; pain_points: string[] }): string {
  // 优先用执行摘要的前 100 字
  if (report.summary && report.summary.length > 10) {
    const trimmed = report.summary.length > 120
      ? report.summary.slice(0, 120) + '...'
      : report.summary;
    return trimmed;
  }
  // 降级用项目描述
  return project.description || '我们正在打造下一代工具,帮助你更快验证市场。';
}

/**
 * 基于报告数据构建副标题(tagline)
 * 从痛点或机会中提取最核心的一条
 */
function buildTagline(report: { pain_points: string[]; opportunities: string[]; market_heat: { trend: string; heat_score: number } }): string {
  // 优先用第一个痛点
  if (report.pain_points && report.pain_points.length > 0) {
    const pain = report.pain_points[0]!;
    return pain.length > 50 ? pain.slice(0, 50) + '...' : pain;
  }
  // 其次用第一个机会
  if (report.opportunities && report.opportunities.length > 0) {
    const opp = report.opportunities[0]!;
    return opp.length > 50 ? opp.slice(0, 50) + '...' : opp;
  }
  // 降级
  const trendText = report.market_heat?.trend === 'rising'
    ? '市场快速增长中'
    : report.market_heat?.trend === 'declining'
    ? '寻找转型新机会'
    : '探索市场新可能';
  return `${trendText} · 热度 ${report.market_heat?.heat_score ?? '--'}/100`;
}
