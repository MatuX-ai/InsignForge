/**
 * HTTP+SSE transport 测试
 *
 * 通过 supertest 风格的 fetch 测试 Express 路由:
 *   - GET  /health
 *   - GET  / (根路径描述)
 *   - GET  /sse (SSE 连接)
 *   - POST /messages (消息路由)
 *
 * 注意:
 * - 不依赖真实 LLM 调用(generate_landing 是纯本地函数)
 * - 使用随机端口避免冲突
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

import { startHttpTransport } from '../src/transport/http.js';
import { createInsightForgeMcpServer } from '../src/server.js';
import { createInsightForgeCore, validateConfig } from '@insightforge/core';
import type { InsightForgeCore } from '@insightforge/core';

describe('HTTP+SSE transport', () => {
  let core: InsightForgeCore;
  let close: () => Promise<void>;
  let port: number;
  let server: Server;

  beforeAll(async () => {
    core = createInsightForgeCore(
      validateConfig({
        llmApiKey: 'sk-http-test',
        // 用 :memory: 不创建 db 文件
        dbPath: ':memory:',
        // 关闭 cache 减少开销
        cacheEnabled: false,
      }),
    );

    const app = express();
    const handle = await startHttpTransport(createInsightForgeMcpServer, core, {
      port: 0, // 让 OS 分配端口
      app,
    });
    close = handle.close;
    port = handle.port;
    // 取得 http.Server 实例以便 afterAll 关闭
    server = handle.httpServer;
  }, 15_000);

  afterAll(async () => {
    try {
      await close();
    } catch {
      /* ignore */
    }
    await new Promise<void>((res) => {
      if (server && server.listening) server.close(() => res());
      else res();
    });
  });

  it('GET /health 应返回 200', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('db');
    expect(body).toHaveProperty('llmAvailable');
  });

  it('GET / 应返回能力清单', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('@insightforge/mcp-server');
    expect(body.transport).toBe('http+sse');
    expect(body.endpoints).toHaveProperty('sse');
    expect(body.endpoints).toHaveProperty('messages');
    expect(body.capabilities.tools).toContain('market_research');
  });

  it('POST /messages 缺 sessionId 应返回 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('E_VALIDATION');
  });

  it('POST /messages 未知 sessionId 应返回 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/messages?sessionId=nonexistent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /sse 应建立 SSE 流并接收 endpoint event', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sse`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // 读取 SSE 前几个字节,验证包含 endpoint 事件
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');

    const decoder = new TextDecoder();
    let received = '';
    // 读取直到拿到 endpoint 事件(SDK 会在连接后立即发送)
    for (let i = 0; i < 5; i++) {
      const { value } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined }>((r) => setTimeout(() => r({ value: undefined }), 1500)),
      ]);
      if (!value) break;
      received += decoder.decode(value);
      if (received.includes('event: endpoint') || received.includes('messages')) break;
    }
    expect(received).toContain('endpoint');

    // 关闭流
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }, 10_000);

  it('完整 roundtrip: 通过 SSE 连接到 messages 路由调用 generate_landing', async () => {
    // 1. 打开 SSE 流
    const sseRes = await fetch(`http://127.0.0.1:${port}/sse`, {
      headers: { accept: 'text/event-stream' },
    });
    const reader = sseRes.body?.getReader();
    if (!reader) throw new Error('no SSE body');
    const decoder = new TextDecoder();

    // 2. 读取 endpoint 事件, 拿到 sessionId
    let endpointInfo = '';
    for (let i = 0; i < 10; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      endpointInfo += decoder.decode(value);
      if (endpointInfo.includes('event: endpoint')) break;
    }
    const match = endpointInfo.match(/data: ([^\n]+)/);
    expect(match).toBeTruthy();
    if (!match) throw new Error('endpoint event not found');
    const sessionId = new URL(match[1].trim(), `http://127.0.0.1:${port}`).searchParams.get('sessionId');
    expect(sessionId).toBeTruthy();

    // 3. 通过 /messages 发送 initialize
    const initReq = {
      jsonrpc: '2.0',
      id: 100,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'http-test', version: '1.0.0' },
      },
    };
    const initRes = await fetch(
      `http://127.0.0.1:${port}/messages?sessionId=${encodeURIComponent(sessionId!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initReq),
      },
    );
    expect(initRes.status).toBe(202); // SDK 内部 handlePostMessage 返回 202 Accepted

    // 4. 等 SSE 收到 initialize 响应
    let sseData = '';
    for (let i = 0; i < 10; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      sseData += decoder.decode(value);
      if (sseData.includes('"id":100')) break;
    }
    expect(sseData).toContain('insightforge');

    // 5. 调用 generate_landing(不需要 LLM)
    const callReq = {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'generate_landing',
        arguments: {
          idea: 'HTTP 测试',
          value_proposition: '通过 SSE 验证',
        },
      },
    };
    const callRes = await fetch(
      `http://127.0.0.1:${port}/messages?sessionId=${encodeURIComponent(sessionId!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(callReq),
      },
    );
    expect(callRes.status).toBe(202); // SDK 内部 handlePostMessage 返回 202 Accepted

    // 6. 读取工具响应
    let toolData = '';
    for (let i = 0; i < 20; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      toolData += decoder.decode(value);
      if (toolData.includes('"id":101')) break;
    }
    expect(toolData).toContain('<!DOCTYPE html>');

    // 清理
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }, 20_000);
});