/**
 * MCP Server 构造 —— @insightforge/mcp-server
 *
 * 该文件是 MCP 服务器的核心,把 @insightforge/core 的能力注册为
 * MCP tools / resources / prompts。
 *
 * 设计要点：
 * 1. 一个 createInsightForgeMcpServer() 工厂函数,接受 InsightForgeCore 实例
 * 2. 注册 4 个 tools / 3 个 resources / 3 个 prompts
 * 3. 每个 tool/resource/prompt 注册独立函数,在 tools/ resources/ prompts/ 子目录
 * 4. 统一错误处理：tool 调用失败 → McpToolError → isError: true 响应
 *
 * 文档:05-集成扩展需求文档.md §3.2
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore } from '@insightforge/core';

import { logger } from './logger.js';
import { registerMarketResearchTool } from './tools/market-research.js';
import { registerSearchDemandTool } from './tools/search-demand.js';
import { registerGenerateLandingTool } from './tools/generate-landing.js';
import { registerCompetitorTool } from './tools/competitor.js';
import { registerStatsResource } from './resources/stats.js';
import { registerRecentReportsResource } from './resources/recent-reports.js';
import { registerDemandSearchResource } from './resources/demand-search.js';
import { registerValidateIdeaPrompt } from './prompts/validate-idea.js';
import { registerQuickResearchPrompt } from './prompts/quick-research.js';
import { registerCompetitorScanPrompt } from './prompts/competitor-scan.js';

/** MCP 服务器基础信息 */
export const MCP_SERVER_NAME = 'insightforge';
export const MCP_SERVER_VERSION = '0.1.0';

/**
 * 创建 InsightForge MCP 服务器实例。
 *
 * 内部已注册全部 tools / resources / prompts,使用方只需 connect() 到 transport。
 *
 * @example
 * ```ts
 * const core = createInsightForgeCore(validateConfig({ llmApiKey: 'sk-...' }));
 * const server = createInsightForgeMcpServer(core);
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createInsightForgeMcpServer(core: InsightForgeCore): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
      instructions:
        'InsightForge 市场调研 MCP 服务器。提供 4 个工具:market_research、search_demand、generate_landing、competitor_analysis。' +
        '当你需要了解某个产品想法的市场情况、查找需求数据、生成落地页或扫描竞品时,使用对应工具。',
    },
  );

  // 注册 4 个 tools
  registerMarketResearchTool(server, core);
  registerSearchDemandTool(server, core);
  registerGenerateLandingTool(server, core);
  registerCompetitorTool(server, core);

  // 注册 3 个 resources(可选)
  registerStatsResource(server, core);
  registerRecentReportsResource(server, core);
  registerDemandSearchResource(server, core);

  // 注册 3 个 prompts(可选)
  registerValidateIdeaPrompt(server);
  registerQuickResearchPrompt(server);
  registerCompetitorScanPrompt(server);

  logger.info(
    {
      tools: 4,
      resources: 3,
      prompts: 3,
    },
    'MCP Server 已构造',
  );

  return server;
}

/**
 * 服务器能力清单(用于打印帮助信息 / 自检)
 */
export const MCP_CAPABILITIES = {
  tools: [
    'market_research',
    'search_demand',
    'generate_landing',
    'competitor_analysis',
  ],
  resources: [
    'insightforge://stats',
    'insightforge://reports/recent',
    'insightforge://demand/{query}',
  ],
  prompts: ['validate-idea', 'quick-research', 'competitor-scan'],
} as const;