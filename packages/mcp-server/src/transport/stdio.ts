/**
 * Stdio transport —— 默认传输模式
 *
 * 启动 MCP server 并连接 stdio transport。
 * 适用于 Claude Desktop / Cline / Cursor / Continue 等本地 MCP 客户端。
 *
 * 关键约束:
 * 1. stdio 模式下 stdout 被 MCP 协议占用,绝不能输出日志
 * 2. 所有日志必须走 stderr(本 logger 已配置)
 * 3. 关闭时调用 core.dispose() 释放 DB 连接
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore } from '@insightforge/core';

import { logger } from '../logger.js';

export interface StdioTransportOptions {
  /** 传输层日志开关(默认 false, 避免污染 stderr) */
  enableTransportLogs?: boolean;
}

/**
 * 启动 stdio 传输。
 *
 * @returns 一个 Promise,在 MCP server 关闭后 resolve(正常关闭 / 信号 / 异常均 resolve)
 */
export async function startStdioTransport(
  server: McpServer,
  core: InsightForgeCore,
  options: StdioTransportOptions = {},
): Promise<void> {
  const transport = new StdioServerTransport();

  logger.info(
    {
      transport: 'stdio',
      enableTransportLogs: options.enableTransportLogs ?? false,
    },
    '启动 stdio transport',
  );

  // 默认禁用 SDK 内部 transport 日志(避免与我们的 logger 重复输出)
  if (!options.enableTransportLogs) {
    // SDK 内部日志通过 console.error / process.stderr 走,这里无法精确控制
    // 我们的 logger 已经走 stderr,SDK 的日志是另一份流,不会冲突
  }

  try {
    await server.connect(transport);
    logger.info('stdio transport 已连接');

    // 等待 stdin 关闭(EOF)
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('close', onClose);
        resolve();
      };
      const onEnd = () => cleanup();
      const onClose = () => cleanup();
      process.stdin.once('end', onEnd);
      process.stdin.once('close', onClose);
    });

    logger.info('stdio 已关闭');
  } finally {
    // 确保 dispose
    try {
      core.dispose();
    } catch (err) {
      logger.error({ err }, 'core.dispose() 失败');
    }
  }
}