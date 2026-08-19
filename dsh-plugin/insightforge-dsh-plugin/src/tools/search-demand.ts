/**
 * search_demand 工具 —— 文档 3.1 节
 *
 * 触发场景:"看看有没有人在讨论 AI 会议纪要工具"
 *
 * 参数:
 * - query: 检索关键词(必填)
 * - limit: 返回条数上限(可选,默认 20,最大 100)
 *
 * 实现:基于 SQLite FTS5 全文检索 market_needs 表
 * - 个人版产生的需求数据会自动出现在检索结果中(FAQ Q4)
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { InsightForgeCore } from '../core/researcher.js';
import type { DemandHit } from '../types.js';

export interface SearchDemandArgs {
  query: string;
  limit?: number;
}

export function searchDemandTool(forge: InsightForgeCore) {
  return defineTool<SearchDemandArgs, DemandHit[]>({
    name: 'search_demand',
    description:
      '在本地需求库中检索与关键词相关的需求条目(Reddit/Hacker News/Google 搜索结果)。当用户希望了解历史上是否有人讨论过某个主题时使用。',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '检索关键词,支持 SQLite FTS5 全文检索语法',
      },
      limit: {
        type: 'number',
        required: false,
        description: '返回条数上限,默认 20,最大 100',
        default: 20,
      },
    },
    output: {
      render: (_args, hits) => [
        {
          type: 'text',
          text:
            hits.length === 0
              ? `未找到与匹配的条目`
              : `找到 ${hits.length} 条相关需求:\n` +
                hits
                  .map(
                    (h, i) =>
                      `[${i + 1}] (${h.source}) ${h.title ?? '(无标题)'}\n${
                        h.content.slice(0, 200)
                      }\n链接:${h.url ?? '(无)'} · 互动:${h.engagement}`
                  )
                  .join('\n\n'),
        },
        { type: 'json', data: hits },
      ],
    },
    async execute(args) {
      if (!args.query || args.query.trim().length === 0) {
        throw new Error('参数 query 必须是非空字符串');
      }
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
      const needs = forge.searchDemand(args.query.trim(), limit);
      return needs.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        source: n.source,
        url: n.url,
        engagement: n.engagement,
        crawled_at: n.crawled_at,
      }));
    },
  });
}