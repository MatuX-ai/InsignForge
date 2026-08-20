/**
 * Resource: insightforge://stats —— 需求库统计
 *
 * 内容: { total: number, bySource: Record<Source, number>, latestCrawlAt: string }
 * 实现: SDK InsightForgeCore.demandStats() + 最近一条 crawled_at 查询
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore } from '@insightforge/core';
import { getDb, hasSqliteBindings } from '@insightforge/core';

import { logger } from '../logger.js';

export function registerStatsResource(
  server: McpServer,
  core: InsightForgeCore,
): void {
  server.resource(
    'stats',
    'insightforge://stats',
    {
      description:
        '本地需求库统计信息:总条数、按来源分布、最近一次采集时间。' +
        '可作为整体活跃度参考指标, 适合在调用 market_research 前先看一眼数据库冷热。',
      mimeType: 'application/json',
    },
    async () => {
      try {
        const stats = core.demandStats();
        let latestCrawlAt: string | null = null;

        if (hasSqliteBindings()) {
          try {
            const db = getDb(core.config);
            const row = db
              .prepare(`SELECT crawled_at FROM market_needs ORDER BY crawled_at DESC LIMIT 1`)
              .get() as { crawled_at: string } | undefined;
            latestCrawlAt = row?.crawled_at ?? null;
          } catch (err) {
            logger.warn({ err }, 'stats: 查询 latestCrawlAt 失败');
          }
        }

        return {
          contents: [
            {
              uri: 'insightforge://stats',
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  total: stats.total,
                  bySource: stats.bySource,
                  latestCrawlAt,
                  generatedAt: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'stats resource 失败');
        return {
          contents: [
            {
              uri: 'insightforge://stats',
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'E_INTERNAL',
                  message: err instanceof Error ? err.message : String(err),
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}