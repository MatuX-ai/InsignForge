/**
 * v2.0: express-session 配置
 *
 * 设计:
 *   - httpOnly cookie(防 XSS)
 *   - SameSite=Lax(OAuth 回调跳转需要)
 *   - secure 由 INSIGHTFORGE_SESSION_COOKIE_SECURE 控制(桌面端默认 false)
 *   - 未配置 INSIGHTFORGE_SESSION_SECRET 时使用强随机默认(每次进程启动变化,
 *     重启后所有 session 失效,符合 MVP 阶段预期)
 *   - total 24h 滚动过期,空闲 12h 过期
 */
import session from 'express-session';
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

declare module 'express-session' {
  interface SessionData {
    /** v2.0: 登录用户本地主键(指向 users.id) */
    userId?: string;
    /** OIDC state(防 CSRF) */
    oidcState?: string;
    /** OIDC code_verifier(PKCE);当前未启用 PKCE,留接口 */
    oidcCodeVerifier?: string;
  }
}

/** 强随机默认 secret(仅用于开发模式;生产应通过 env 注入) */
function getSessionSecret(): string {
  if (config.INSIGHTFORGE_SESSION_SECRET) return config.INSIGHTFORGE_SESSION_SECRET;
  const generated = crypto.randomBytes(48).toString('hex');
  logger.warn(
    'INSIGHTFORGE_SESSION_SECRET 未配置,使用临时随机 secret(重启后会话失效)。生产请设置环境变量'
  );
  return generated;
}

/**
 * 创建 express-session 中间件实例。
 * 单例懒加载,首次调用时初始化(便于根据 env 调整行为)。
 */
let _middleware: ReturnType<typeof session> | null = null;

export function getSessionMiddleware(): ReturnType<typeof session> {
  if (_middleware) return _middleware;
  _middleware = session({
    name: 'if.sid',
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.INSIGHTFORGE_SESSION_COOKIE_SECURE,
      maxAge: 24 * 60 * 60 * 1000, // 24h
    },
  });
  return _middleware;
}

/**
 * 测试辅助:重置单例(单测想替换 secret / cookie 时使用)
 */
export function _resetSessionMiddlewareForTest(): void {
  _middleware = null;
}