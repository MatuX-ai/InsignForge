/**
 * market_research 工具 —— 文档 3.2.3
 *
 * 触发场景："帮我验证一下远程结对编程工具的市场"
 *
 * 参数:
 * - idea: 用户的产品想法(必填, 至少 3 字符)
 * - depth: quick / standard / deep(可选, 默认 standard)
 *
 * 实现：调用 SDK InsightForgeCore.research()
 * 错误：LLM 失败 / 搜索失败 / DB 失败 → 分类为 E_LLM_* / E_SEARCH_* / E_DB_*
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore, MarketReport, ResearchDepth } from '@insightforge/core';

import { classifyError, errorToMcpContent } from './errors.js';
import { pushRecentReport } from '../resources/recent-reports-store.js';

/** 输入 schema(描述给 MCP 客户端看) */
const MarketResearchInput = {
  idea: z
    .string()
    .min(3, 'idea 至少 3 个字符')
    .describe('用户的产品想法或项目描述,例如 "AI 会议纪要工具"'),
  depth: z
    .enum(['quick', 'standard', 'deep'])
    .default('standard')
    .describe('调研深度:quick(快速 60s)/ standard(标准 180s)/ deep(深度 360s)'),
} as const;

export function registerMarketResearchTool(
  server: McpServer,
  core: InsightForgeCore,
): void {
  server.tool(
    'market_research',
    '基于用户提供的产品想法进行市场调研,生成包含 7 章节的结构化报告(执行摘要、市场热度、竞品、用户痛点、市场规模、风险、机会)。' +
      '当用户希望验证一个产品想法、进行市场分析、或回答 "这个想法值不值得做" 时使用。' +
      '示例触发语:"帮我调研一下 AI 会议纪要工具的市场"、"远程结对编程还值得做吗"。',
    MarketResearchInput,
    async (args: { idea: string; depth: ResearchDepth }) => {
      try {
        if (!args.idea || args.idea.trim().length < 3) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'E_VALIDATION: idea 必须是非空字符串(至少 3 个字符)',
              },
            ],
          };
        }

        const researchResult = await core.research({
          idea: args.idea.trim(),
          depth: args.depth,
        });

        const report = researchResult.report;

        // 写入 recent-reports store,供 insightforge://reports/recent resource 读取
        pushRecentReport({
          projectId: researchResult.sessionId,
          idea: args.idea.trim(),
          depth: args.depth,
          generatedAt: report.generated_at,
          summary: report.summary.slice(0, 280),
          fromCache: researchResult.fromCache,
          durationMs: researchResult.durationMs,
        });

        return {
          content: [
            { type: 'text' as const, text: formatReport(report) },
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  sessionId: researchResult.sessionId,
                  fromCache: researchResult.fromCache,
                  durationMs: researchResult.durationMs,
                  aggregate: researchResult.aggregate,
                  report,
                },
                null,
                2,
              ),
              _meta: {
                sessionId: researchResult.sessionId,
                durationMs: researchResult.durationMs,
                fromCache: researchResult.fromCache,
              },
            },
          ],
        };
      } catch (err) {
        const toolErr = classifyError(err);
        return {
          isError: true,
          content: errorToMcpContent(toolErr),
        };
      }
    },
  );
}

/**
 * 报告格式化(7 章节 markdown 渲染)
 *
 * 与 dsh-plugin version 保持字符级一致,确保 dsh / MCP 客户端看到的格式相同。
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