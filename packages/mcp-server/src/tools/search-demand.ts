/**
 * search_demand 工具 —— 文档 3.2.3
 *
 * 触发场景："看看有没有人在讨论 AI 会议纪要工具"
 *
 * 参数:
 * - query: 检索关键词(必填)
 * - limit: 返回条数上限(可选, 默认 20, 最大 100)
 *
 * 实现: SDK InsightForgeCore.searchDemand()(基于 SQLite FTS5)
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore, DemandHit } from '@insightforge/core';

import { classifyError, errorToMcpContent } from './errors.js';

const SearchDemandInput = {
  query: z
    .string()
    .min(1, 'query 不能为空')
    .describe('检索关键词, 支持 SQLite FTS5 前缀匹配语法'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('返回条数上限, 默认 20, 最大 100'),
} as const;

export function registerSearchDemandTool(
  server: McpServer,
  core: InsightForgeCore,
): void {
  server.tool(
    'search_demand',
    '在本地需求库中检索与关键词相关的需求条目(来自 Reddit / Hacker News / Google 搜索)。' +
      '当用户希望了解历史上是否有人讨论过某个主题、或当前需求库中是否已有相关数据时使用。' +
      '示例触发语:"看看有没有人在讨论 AI 会议纪要工具"、"搜索一下远程结对编程相关的需求"。',
    SearchDemandInput,
    async (args: { query: string; limit: number }) => {
      try {
        if (!args.query || args.query.trim().length === 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'E_VALIDATION: query 必须是非空字符串',
              },
            ],
          };
        }

        const needs = core.searchDemand(args.query.trim(), args.limit);
        const hits: DemandHit[] = needs.map((n) => ({
          id: n.id,
          title: n.title,
          content: n.content,
          source: n.source,
          url: n.url,
          engagement: n.engagement,
          crawled_at: n.crawled_at,
        }));

        const text =
          hits.length === 0
            ? `未找到与 "${args.query}" 匹配的条目`
            : `找到 ${hits.length} 条相关需求:\n` +
              hits
                .map(
                  (h, i) =>
                    `[${i + 1}] (${h.source}) ${h.title ?? '(无标题)'}\n${h.content.slice(0, 200)}\n链接:${h.url ?? '(无)'} · 互动:${h.engagement}`,
                )
                .join('\n\n');

        return {
          content: [
            { type: 'text' as const, text },
            {
              type: 'text' as const,
              text: JSON.stringify({ query: args.query, count: hits.length, hits }, null, 2),
              _meta: { query: args.query, count: hits.length },
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