/**
 * InsightForge 后端入口
 * 启动顺序: 配置 → 数据库 → 路由 → 监听
 *
 * 桌面模式支持(环境变量控制,不影响原有 Web 部署):
 *   - PORT=0: 监听随机可用端口,启动后通过 IPC(process.send)上报实际端口
 *   - SERVE_FRONTEND=<dist 目录>: 托管前端静态资源并提供 SPA fallback
 */
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { getDb } from './db/index.js';
import { apiRouter } from './api/index.js';
import {
  startAllSchedulers,
  stopAllSchedulers,
} from './services/scheduler/index.js';
import { getSessionMiddleware } from './services/auth/session.js';
import { getDisabledSourceNotes } from './services/search/sourceWeights.js';

const app = express();

// ---------- 中间件 ----------
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

// v2.0: 接入 express-session(为 OIDC 登录提供 cookie 载体)
app.use(getSessionMiddleware());

// 请求日志(简化版)
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url }, 'HTTP 请求');
  next();
});

// ---------- 根路由 ----------
// 桌面模式(SERVE_FRONTEND)下该路径由前端静态资源接管, 跳过 API 信息页
if (!process.env.SERVE_FRONTEND) {
  app.get('/', (_req, res) => {
    res.json({
      name: 'InsightForge Backend',
      version: '1.0.0',
      docs: 'http://localhost:3001/api/v1/health',
    });
  });
}

// 健康检查
app.get('/health', (_req, res) => {
  try {
    getDb(); // 触发连接
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ status: 'fail', error: String(err) });
  }
});

// API v1
app.use('/api/v1', apiRouter);

// ---------- 桌面模式: 托管前端静态资源(SPA) ----------
// 需放在 404 中间件之前; 非 /api 路径一律回退到 index.html
const frontendDist = process.env.SERVE_FRONTEND;
if (frontendDist) {
  const distDir = path.resolve(frontendDist);
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'), (err) => {
        if (err) next();
      });
    });
    logger.info({ distDir }, '已托管前端静态资源(桌面模式)');
  } else {
    logger.warn({ distDir }, 'SERVE_FRONTEND 目录不存在,跳过静态托管');
  }
}

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, message: `路径不存在: ${req.method} ${req.url}` });
});

// 错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, '未捕获异常');
  res.status(500).json({ code: 500, message: err.message });
});

// ---------- 启动 ----------
const server = app.listen(config.PORT, () => {
  // 启动时确保数据库就绪
  getDb();
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : config.PORT;
  logger.info(
    {
      port: actualPort,
      env: config.NODE_ENV,
      llm: config.LLM_PROVIDER,
      search: config.SEARCH_PROVIDER,
    },
    `InsightForge 后端已启动 -> http://localhost:${actualPort}`
  );
  // v1.7: 启动期主动报告「未启用骨架源」名单,便于运维一眼看到哪几个源暂未接实
  const disabled = getDisabledSourceNotes();
  if (disabled.length > 0) {
    logger.warn(
      { sources: disabled },
      '以下数据源当前为骨架(未实装匿名抓取,接口永远返回空数组,不影响其他源)'
    );
  }
  // 启动所有已注册后台任务(v1.6: 通过统一注册表启动 LLM 缓存清理等)
  // 与 retryMetrics 的 lazy start 不同:这些属于 housekeeping,
  // 与是否有 LLM 调用无关,服务一启动就应该周期清理
  startAllSchedulers();
  // 桌面模式: 通过 IPC 向父进程(Electron 主进程)上报实际端口
  if (process.send) {
    process.send({ type: 'ready', port: actualPort });
  }
});

// 优雅关闭
const shutdown = (signal: string) => {
  logger.info({ signal }, '收到关闭信号');
  // 先停调度器,避免 server.close 等待期间被并发触发清理任务
  stopAllSchedulers();
  server.close(() => {
    logger.info('HTTP 服务已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));