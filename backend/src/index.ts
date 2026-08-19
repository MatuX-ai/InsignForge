/**
 * InsightForge 后端入口
 * 启动顺序: 配置 → 数据库 → 路由 → 监听
 */
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { logger } from './logger.js';
import { getDb } from './db/index.js';
import { apiRouter } from './api/index.js';

const app = express();

// ---------- 中间件 ----------
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

// 请求日志(简化版)
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url }, 'HTTP 请求');
  next();
});

// ---------- 根路由 ----------
app.get('/', (_req, res) => {
  res.json({
    name: 'InsightForge Backend',
    version: '1.0.0',
    docs: 'http://localhost:3001/api/v1/health',
  });
});

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
  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      llm: config.LLM_PROVIDER,
      search: config.SEARCH_PROVIDER,
    },
    `InsightForge 后端已启动 -> http://localhost:${config.PORT}`
  );
});

// 优雅关闭
const shutdown = (signal: string) => {
  logger.info({ signal }, '收到关闭信号');
  server.close(() => {
    logger.info('HTTP 服务已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));