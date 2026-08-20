/**
 * @insightforge/mcp-server 专用 logger
 *
 * 与 SDK 的 logger 隔离，便于：
 * 1. MCP 服务器可以在 stdio 模式下输出到 stderr（避免污染 MCP 协议流）
 * 2. 单独的 log level / transport 配置
 *
 * 默认输出到 stderr（process.stderr），因为 stdio 模式下 stdout 被 MCP 协议占用。
 */
import pino from 'pino';

export type McpLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface McpLoggerOptions {
  level?: McpLogLevel;
  /** 自定义写入流，默认 process.stderr */
  destination?: NodeJS.WritableStream;
  /** 关闭 pretty（stdio 模式下绝对不要开启，否则会污染协议） */
  pretty?: boolean;
}

/**
 * 创建 MCP 服务器 logger。
 *
 * 关键约束：stdio 模式下 stdout 被 MCP 协议占用，所有日志必须走 stderr。
 */
export function createMcpLogger(options: McpLoggerOptions = {}): pino.Logger {
  const level = options.level ?? 'info';
  const destination = options.destination ?? process.stderr;

  const baseOptions: pino.LoggerOptions = {
    level,
    base: { pkg: '@insightforge/mcp-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // 显式指定 destination，避免依赖默认 stdout
  return pino(baseOptions, destination as pino.DestinationStream);
}

/** 默认 logger（info 级别，输出到 stderr） */
export const logger = createMcpLogger();

/**
 * 从字符串解析 log level，未知值降级为 info。
 */
export function parseLogLevel(value: string | undefined): McpLogLevel {
  switch ((value ?? '').toLowerCase()) {
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
    case 'warning':
      return 'warn';
    case 'error':
      return 'error';
    case 'silent':
    case 'off':
    case 'none':
      return 'silent';
    default:
      return 'info';
  }
}