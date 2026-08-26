/**
 * 验证落地页路由
 * POST /api/v1/projects/:id/landing
 *
 * 基于市场报告数据自动生成验证落地页 HTML
 * 使用 packages/core 中的 landing 生成器
 */
import { Router } from 'express';
import { ProjectService } from '../services/ProjectService.js';
import { ReportService } from '../services/ReportService.js';
import { asyncHandler, ok, fail } from './response.js';
import { generateLanding } from '../utils/landingGenerator.js';

export const landingRouter = Router({ mergeParams: true });

landingRouter.post(
  '/',
  asyncHandler<{ params: { id: string } }>((req, res) => {
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

    const result = generateLanding({
      idea: project.name,
      value_proposition: valueProposition,
      call_to_action: '加入等待列表',
      theme: 'light',
      tagline,
    });

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
