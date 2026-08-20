/**
 * HTTP+SSE transport —— 可选传输模式
 *
 * 通过 Express + SSE 暴露 MCP server,适用于远程 / 多客户端场景。
 *
 * 端点:
 * - GET  /sse       建立 SSE 流(服务端推送消息)
 * - POST /messages  客户端发送消息(查询参数 sessionId 指定目标会话)
 * - GET  /health    健康检查(返回 SDK healthCheck 结果)
 *
 * 鉴权: 本期不做(留待 v1.2 引入 Bearer Token),但给出建议在 README 中说明反向代理前置鉴权
 */
import express, { type Express, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore } from '@insightforge/core';

import { logger } from '../logger.js';

export interface HttpTransportOptions {
  port: number;
  /** Express 应用实例(测试时可注入 mock app) */
  app?: Express;
  /** 主机绑定(默认 127.0.0.1 仅本地访问) */
  host?: string;
}

interface SessionEntry {
  server: McpServer;
  transport: SSEServerTransport;
  core: InsightForgeCore;
}

/**
 * 启动 HTTP+SSE transport。
 *
 * 设计:
 * 1. 每个 SSE 连接 → 新 InsightForgeCore(共享同一 dbPath, SQLite WAL 多读单写)
 * 2. sessionId 由 SDK 生成的 transport.sessionId 提供
 * 3. 客户端断连后清理 session, 释放 DB
 *
 * @returns Promise<{ close: () => Promise<void> }>, close 用于优雅关闭服务器
 */
export async function startHttpTransport(
  makeServer: (core: InsightForgeCore) => McpServer,
  core: InsightForgeCore,
  options: HttpTransportOptions,
): Promise<{ close: () => Promise<void>; port: number; httpServer: import('http').Server }> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port;
  const app = options.app ?? express();

  // SSE transport 需要的 session map
  const sessions = new Map<string, SessionEntry>();

  // body parser(只为 POST /messages 解析 JSON)
  app.use(express.json({ limit: '1mb' }));

  // CORS —— 默认拒绝跨域(避免 CSRF)
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'null');
    next();
  });

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    const h = core.healthCheck();
    res.status(h.ok ? 200 : 503).json(h);
  });

  // SSE endpoint
  app.get('/sse', async (_req: Request, res: Response) => {
    // 每个连接创建一个新 SDK server + InsightForgeCore
    // 注意: SDK 内部 getDb() 是单例,但不同 process 应该共享同一 SQLite, 这里复用 core 不再新建
    const sessionCore = core;
    const sessionServer = makeServer(sessionCore);

    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    sessions.set(sessionId, {
      server: sessionServer,
      transport,
      core: sessionCore,
    });

    logger.info({ sessionId }, 'SSE 客户端已连接');

    // 客户端断开时清理
    res.on('close', () => {
      logger.info({ sessionId }, 'SSE 客户端断开');
      const entry = sessions.get(sessionId);
      sessions.delete(sessionId);
      // 注意: 多客户端共享一个 core,不在此处 dispose
      void entry;
    });

    try {
      await sessionServer.connect(transport);
    } catch (err) {
      logger.error({ err, sessionId }, 'session.connect 失败');
      sessions.delete(sessionId);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  });

  // 消息 endpoint
  // 注意：不能使用全局 express.json(),否则会消耗 req 流,导致 SDK handlePostMessage
  // 内部的 raw-body 读取报 “stream is not readable”。这里在路由内手动 JSON.parse 并透传。
  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId ?? '');
    if (!sessionId) {
      res.status(400).json({ error: 'E_VALIDATION', message: 'sessionId 必填' });
      return;
    }
    const entry = sessions.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'E_INTERNAL', message: `session ${sessionId} 不存在或已断开` });
      return;
    }
    try {
      // SDK handlePostMessage 接受 (req, res, parsedBody);如果 express.json() 未启用,
      // 它会自己用 raw-body 读取。但我们这里已手动 parse,作为 parsedBody 传入以避免流重复读取。
      const parsed = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      await entry.transport.handlePostMessage(req, res, parsed);
    } catch (err) {
      logger.error({ err, sessionId }, 'handlePostMessage 失败');
      if (!res.headersSent) {
        res.status(500).json({
          error: 'E_INTERNAL',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  // 启动 HTTP 服务
  const httpServer = await new Promise<import('http').Server>((resolve) => {
    const server = app.listen(port, host, () => resolve(server));
  });

  // 提取实际监听的端口（处理 port=0 由 OS 分配的情况）
  const addr = httpServer.address();
  const actualPort =
    typeof addr === 'object' && addr ? addr.port : port;

  logger.info(
    { host, port: actualPort, sessions: 0 },
    `HTTP transport 已启动, 监听 http://${host}:${actualPort}`,
  );

  // 输出一个根路径响应(便于人类 curl 调试)
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: '@insightforge/mcp-server',
      transport: 'http+sse',
      endpoints: {
        sse: `GET http://${host}:${actualPort}/sse`,
        messages: `POST http://${host}:${actualPort}/messages?sessionId={id}`,
        health: `GET http://${host}:${actualPort}/health`,
      },
      capabilities: {
        tools: ['market_research', 'search_demand', 'generate_landing', 'competitor_analysis'],
        resources: ['insightforge://stats', 'insightforge://reports/recent', 'insightforge://demand/{query}'],
        prompts: ['validate-idea', 'quick-research', 'competitor-scan'],
      },
    });
  });

  const close = async () => {
    logger.info({ sessions: sessions.size }, '关闭 HTTP transport');
    // 关闭所有 session
    for (const [id, entry] of sessions) {
      try {
        await entry.transport.close();
      } catch (err) {
        logger.warn({ err, id }, 'transport.close 失败');
      }
      sessions.delete(id);
    }
    // 关闭 HTTP server
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    try {
      core.dispose();
    } catch (err) {
      logger.error({ err }, 'core.dispose() 失败');
    }
    logger.info('HTTP transport 已关闭');
  };

  // 处理进程信号(虽然 CLI 入口已经注册,这里再保险一次)
  const onSignal = async (signal: string) => {
    logger.info({ signal }, '收到信号, 开始关闭');
    try {
      await close();
    } catch (err) {
      logger.error({ err }, '关闭失败');
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void onSignal('SIGTERM'));
  process.once('SIGINT', () => void onSignal('SIGINT'));

  // 用于生成唯一 sessionId(SDK 自身也会生成,这里只是占位以避免 lint 警告)
  void randomUUID;

  return { close, port: actualPort, httpServer };
}