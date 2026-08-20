/**
 * competitor_analysis 工具 —— 文档 3.2.3
 *
 * 触发场景："帮我看看这个赛道有哪些竞品"
 *
 * 参数:
 * - domain: 行业 / 赛道关键词(必填)
 * - limit: 期望返回的竞品数量(可选, 默认 5, 最大 20)
 *
 * 实现: SDK InsightForgeCore.analyzeCompetitors()(LLM + 搜索)
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore, CompetitorEntry } from '@insightforge/core';

import { classifyError, errorToMcpContent } from './errors.js';

const CompetitorInput = {
  domain: z
    .string()
    .min(1, 'domain 不能为空')
    .describe('行业或赛道关键词, 例如 "AI 会议纪要"、"远程结对编程"'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('期望返回的竞品数量, 默认 5, 最大 20'),
} as const;

export function registerCompetitorTool(
  server: McpServer,
  core: InsightForgeCore,
): void {
  server.tool(
    'competitor_analysis',
    '分析指定行业 / 赛道的主要竞品, 返回竞品名称、定位、优劣势、市场角色(leader / challenger / niche)。' +
      '当用户希望了解某个领域的市场格局、或在 idea 阶段想知道类似产品时使用。' +
      '示例触发语:"帮我看看这个赛道有哪些竞品"、"扫描 AI 会议纪要市场"。',
    CompetitorInput,
    async (args: { domain: string; limit: number }) => {
      try {
        if (!args.domain || args.domain.trim().length === 0) {
          return {
            isError: true,
            content: [
              { type: 'text' as const, text: 'E_VALIDATION: domain 必须是非空字符串' },
            ],
          };
        }

        const competitors: CompetitorEntry[] = await core.analyzeCompetitors(
          args.domain.trim(),
          args.limit,
        );

        const text =
          competitors.length === 0
            ? `未在 "${args.domain}" 领域识别到竞品`
            : `识别到 ${competitors.length} 个相关竞品:\n` +
              competitors
                .map(
                  (c, i) =>
                    `[${i + 1}] ${c.name} _(${c.market_position ?? '未知'})_\n${c.description}\n` +
                    (c.url ? `链接:${c.url}\n` : '') +
                    (c.strengths?.length ? `优势:${c.strengths.join(' / ')}\n` : '') +
                    (c.weaknesses?.length ? `不足:${c.weaknesses.join(' / ')}` : ''),
                )
                .join('\n\n');

        return {
          content: [
            { type: 'text' as const, text },
            {
              type: 'text' as const,
              text: JSON.stringify(
                { domain: args.domain, count: competitors.length, competitors },
                null,
                2,
              ),
              _meta: { domain: args.domain, count: competitors.length },
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