/**
 * Resource: insightforge://reports/recent —— 最近 10 条调研报告摘要
 *
 * 内容: Array<{ projectId, idea, depth, generatedAt, summary, fromCache, durationMs }>
 * 实现: 进程内 recent-reports-store(由 market_research 工具每次成功调用后写入)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore } from '@insightforge/core';

import { listRecentReports } from './recent-reports-store.js';

export function registerRecentReportsResource(
  server: McpServer,
  _core: InsightForgeCore,
): void {
  server.resource(
    'reports-recent',
    'insightforge://reports/recent',
    {
      description:
        '最近 10 条市场调研报告摘要(projectId / idea / depth / 生成时间 / summary 前 280 字符 / 是否命中缓存 / 耗时)。' +
        '基于进程内 LRU, 重启 MCP server 后会清空, 历史报告请直接查 SQLite。',
      mimeType: 'application/json',
    },
    async () => {
      const items = listRecentReports(10);
      return {
        contents: [
          {
            uri: 'insightforge://reports/recent',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                count: items.length,
                items,
                generatedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}