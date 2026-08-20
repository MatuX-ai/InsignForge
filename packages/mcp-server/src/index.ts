/**
 * @insightforge/mcp-server 公共 API 入口
 *
 * 内部按职责分目录:
 * - tools/        4 个 MCP tools 注册函数
 * - resources/    3 个 MCP resources (含 1 个动态模板)
 * - prompts/      3 个 MCP prompts
 * - transport/    stdio / http+sse 两种传输
 *
 * 本入口仅做 re-export,不包含业务逻辑。CLI 入口在 bin/insightforge-mcp.mjs。
 *
 * 文档:05-集成扩展需求文档.md §3.2
 */

// ---------- Server 工厂 ----------
export {
  createInsightForgeMcpServer,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_CAPABILITIES,
} from './server.js';

// ---------- Transport ----------
export { startStdioTransport, type StdioTransportOptions } from './transport/stdio.js';
export {
  startHttpTransport,
  type HttpTransportOptions,
} from './transport/http.js';

// ---------- Config 加载 ----------
export {
  loadConfig,
  buildConfigFromEnv,
  parseCliArgs,
  loadConfigFile,
  McpConfigError,
  McpToolError,
  type ToolErrorKind,
  type CliArgs,
  type LoadedMcpConfig,
  type TransportMode,
} from './config-loader.js';

// ---------- Logger ----------
export {
  createMcpLogger,
  parseLogLevel as parseLogLevelFromString,
  logger as defaultLogger,
  type McpLogLevel,
  type McpLoggerOptions,
} from './logger.js';

// ---------- Tools (re-export 注册函数,便于第三方工具单独引用) ----------
export { registerMarketResearchTool, formatReport } from './tools/market-research.js';
export { registerSearchDemandTool } from './tools/search-demand.js';
export { registerGenerateLandingTool } from './tools/generate-landing.js';
export { registerCompetitorTool } from './tools/competitor.js';
export { classifyError, sanitize, errorToMcpContent, ERROR_KINDS } from './tools/errors.js';

// ---------- Resources ----------
export { registerStatsResource } from './resources/stats.js';
export { registerRecentReportsResource } from './resources/recent-reports.js';
export { registerDemandSearchResource } from './resources/demand-search.js';
export {
  pushRecentReport,
  listRecentReports,
  clearRecentReports,
  recentReportsSize,
  type RecentReportSummary,
} from './resources/recent-reports-store.js';

// ---------- Prompts ----------
export { registerValidateIdeaPrompt } from './prompts/validate-idea.js';
export { registerQuickResearchPrompt } from './prompts/quick-research.js';
export { registerCompetitorScanPrompt } from './prompts/competitor-scan.js';

// ---------- 版本号 ----------
export const VERSION = '0.1.0';