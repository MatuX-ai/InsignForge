/**
 * market_research 工具 —— 文档 3.1 节
 *
 * 触发场景:"帮我验证一下远程结对编程工具的市场"
 *
 * 参数:
 * - idea: 用户的产品想法(必填)
 * - depth: quick / standard / deep(可选,默认 standard)
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { InsightForgeCore } from '../core/researcher.js';
import type { MarketReport, ResearchDepth } from '../types.js';

export interface MarketResearchArgs {
  idea: string;
  depth?: ResearchDepth;
}

export function marketResearchTool(forge: InsightForgeCore) {
  return defineTool<MarketResearchArgs, MarketReport>({
    name: 'market_research',
    description:
      '基于用户提供的产品想法进行市场调研,生成包含市场热度、竞品识别、用户痛点、市场规模估算的结构化报告。当用户需要验证一个产品想法或进行市场分析时使用。',
    parameters: {
      idea: {
        type: 'string',
        required: true,
        description: '用户的产品想法或项目描述',
      },
      depth: {
        type: 'string',
        required: false,
        description: '调研深度:quick(快速) / standard(标准) / deep(深度)',
        enum: ['quick', 'standard', 'deep'],
        default: 'standard',
      },
    },
    output: {
      render: (_args, report) => [
        { type: 'text', text: formatReport(report) },
        { type: 'json', data: report },
      ],
    },
    async execute(args) {
      if (!args.idea || args.idea.trim().length < 3) {
        throw new Error('参数 idea 必须是非空字符串(至少 3 个字符)');
      }
      if (args.depth && !['quick', 'standard', 'deep'].includes(args.depth)) {
        throw new Error(`参数 depth 必须是 quick/standard/deep 之一,得到: ${args.depth}`);
      }
      const result = await forge.research({
        idea: args.idea.trim(),
        depth: args.depth,
      });
      return result.report;
    },
  });
}

/**
 * 报告格式化(7 章节 markdown 渲染)
 * 工具的 output.render 会调用此函数生成 UI 友好的展示文本
 */
export function formatReport(report: MarketReport): string {
  const lines: string[] = [];
  lines.push(`# 市场调研报告`);
  lines.push(`**生成时间**:${report.generated_at}`);
  lines.push(`**调研深度**:${report.depth}`);
  lines.push(`**关键词**:${report.keywords.join('、')}`);
  lines.push('');

  lines.push(`## 1. 执行摘要`);
  lines.push(report.summary);
  lines.push('');

  lines.push(`## 2. 市场热度`);
  lines.push(`- 月搜索量(估算):${report.market_heat.search_volume}`);
  lines.push(`- 社区讨论量(估算):${report.market_heat.discussion_count}`);
  lines.push(`- 趋势:${report.market_heat.trend}`);
  lines.push(`- 综合热度评分(0-100):${report.market_heat.heat_score}`);
  lines.push('');

  lines.push(`## 3. 竞品识别`);
  for (const c of report.competitors) {
    lines.push(`### ${c.name}`);
    lines.push(c.description);
    if (c.url) lines.push(`链接:${c.url}`);
    if (c.strengths?.length) lines.push(`- 优势:${c.strengths.join(' / ')}`);
    if (c.weaknesses?.length) lines.push(`- 不足:${c.weaknesses.join(' / ')}`);
    lines.push('');
  }

  lines.push(`## 4. 用户痛点`);
  for (const p of report.pain_points) lines.push(`- ${p}`);
  lines.push('');

  lines.push(`## 5. 市场规模估算`);
  lines.push(report.market_size);
  lines.push('');

  lines.push(`## 6. 风险`);
  for (const r of report.risks) lines.push(`- ${r}`);
  lines.push('');

  lines.push(`## 7. 机会`);
  for (const o of report.opportunities) lines.push(`- ${o}`);
  lines.push('');

  lines.push(`## 数据来源(${report.sources.length} 条)`);
  for (const s of report.sources) {
    lines.push(`- [${s.title}](${s.url})${s.source ? ` _(${s.source})_` : ''}`);
  }
  return lines.join('\n');
}