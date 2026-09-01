/**
 * v2.0: 鉴权中间件
 *
 * 设计:
 *   - INSIGHTFORGE_AUTH_ENABLED=false 时所有中间件为 no-op(向后兼容)
 *   - attachUser / optionalAuth: 即使未登录也 next,但会尝试从 session 挂 req.user
 *   - requireAuth: 未登录返回 401
 *
 * 双轨制:
 *   - 路由同时挂 optionalAuth(挂 user) + requireAuth(校验登录) 是常见组合
 *   - 关闭鉴权时所有中间件等同 no-op,逻辑与 v1.6 完全一致
 */
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { findById, type UserRecord } from '../services/auth/userService.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** v2.0: 当前登录用户(若有)。未登录时为 null/undefined */
    user?: UserRecord | null;
  }
}

/**
 * 尝试从 session 中读取 userId → 查 users 表 → 挂到 req.user。
 * 未登录时 next()(req.user 保持 undefined)。
 *
 * 若 INSIGHTFORGE_AUTH_ENABLED=false,等价于 no-op,直接 next。
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  if (!config.INSIGHTFORGE_AUTH_ENABLED) return next();
  const userId = req.session?.userId;
  if (!userId) {
    req.user = null;
    return next();
  }
  const user = findById(userId);
  req.user = user;
  next();
}

/**
 * requireAuth: 未登录返回 401。
 * 鉴权关闭时为 no-op(向后兼容 v1.6 行为)。
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.INSIGHTFORGE_AUTH_ENABLED) return next();
  if (!req.user) {
    res.status(401).json({ code: 401, message: '未登录,请先通过 Casdoor 登录' });
    return;
  }
  next();
}

/** optionalAuth 等价于 attachUser(更直观的命名) */
export const optionalAuth = attachUser;