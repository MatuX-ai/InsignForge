/**
 * Resource Template: insightforge://demand/{query} —— 需求库检索结果(动态 URI)
 *
 * URI 模板: insightforge://demand/{query}?limit={limit}
 * 实现: SDK InsightForgeCore.searchDemand()
 */
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore, DemandHit } from '@insightforge/core';

export function registerDemandSearchResource(
  server: McpServer,
  core: InsightForgeCore,
): void {
  server.resource(
    'demand-search',
    new ResourceTemplate('insightforge://demand/{query}', {
      list: undefined,
      complete: {
        // 让 MCP 客户端在输入时获得 query 提示
        query: (value) => {
          // 简单的关键词补全: 返回所有以 value 开头的常见关键词(此处只做示例)
          const suggestions = [
            'AI', 'productivity', 'developer tools', 'remote work',
            'meetings', 'notes', 'pair programming', 'chat',
          ];
          return suggestions.filter((s) => s.toLowerCase().startsWith(value.toLowerCase()));
        },
      },
    }),
    {
      description:
        '按 query 检索需求库, 返回 DemandHit[]。URI 模板: insightforge://demand/{query}?limit={limit}。' +
        '等价于 search_demand 工具的只读版, 适合订阅式数据接入场景。',
      mimeType: 'application/json',
    },
    async (uri, params) => {
      const query = String(params.query ?? '').trim();
      if (!query) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'E_VALIDATION', message: 'query 不能为空' }, null, 2),
            },
          ],
        };
      }

      // 解析 limit 参数
      const limitParam = uri.searchParams.get('limit');
      let limit = 20;
      if (limitParam) {
        const n = Number(limitParam);
        if (Number.isInteger(n) && n >= 1 && n <= 100) {
          limit = n;
        }
      }

      try {
        const needs = core.searchDemand(query, limit);
        const hits: DemandHit[] = needs.map((n) => ({
          id: n.id,
          title: n.title,
          content: n.content,
          source: n.source,
          url: n.url,
          engagement: n.engagement,
          crawled_at: n.crawled_at,
        }));

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                { query, limit, count: hits.length, hits },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
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