/**
 * v2.0: 配额中间件
 *
 * 设计:
 *   - 仅在 INSIGHTFORGE_AUTH_ENABLED=true 时生效
 *   - 按 user_id + UTC 日期统计进程内调用次数;重启清零(v2.0 阶段够用)
 *   - free 计划默认 50 次/天;pro 计划默认 1000 次/天
 *   - 越界返回 429 + 业务错误码 QUOTA_EXCEEDED
 *
 * 注意:
 *   - 当前是窗口式 in-memory 计数器(简单),未来可接 Redis
 *   - 仅在登录用户上生效;未登录用户(双轨制公共数据)不受配额限制
 */
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';

/** 各计划日上限 */
const PLAN_DAILY_LIMITS: Record<string, number> = {
  free: 50,
  pro: 1000,
};

/** 进程内窗口计数器: userId(plan_type) → UTC date → 当前计数 */
const _counters = new Map<string, { date: string; count: number }>();

/** 默认计划(free / 50 次) */
const DEFAULT_LIMIT = PLAN_DAILY_LIMITS.free!;

/** 公共接口:暴露给前端"今日剩余"展示 */
export function getQuotaSnapshot(userId: string, planType: string): {
  planType: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
} {
  const limit = PLAN_DAILY_LIMITS[planType] ?? DEFAULT_LIMIT;
  const utcDate = new Date().toISOString().slice(0, 10);
  const entry = _counters.get(userId);
  const used = entry && entry.date === utcDate ? entry.count : 0;
  return {
    planType,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    // UTC 0 点
    resetAt: `${utcDate}T00:00:00.000Z`,
  };
}

/**
 * 检查当前请求是否超额;未超额则递增计数并 next。
 * 必须挂在 requireAuth 之后(req.user 已保证存在)。
 */
export function checkLlmQuota(req: Request, res: Response, next: NextFunction): void {
  // 鉴权关闭时为 no-op
  if (!config.INSIGHTFORGE_AUTH_ENABLED) return next();
  // 未登录用户不受配额限制(双轨制公共数据)
  if (!req.user) return next();

  const user = req.user;
  const limit = PLAN_DAILY_LIMITS[user.plan_type] ?? DEFAULT_LIMIT;
  const utcDate = new Date().toISOString().slice(0, 10);
  const key = user.id;
  const existing = _counters.get(key);

  let count: number;
  if (!existing || existing.date !== utcDate) {
    _counters.set(key, { date: utcDate, count: 1 });
    count = 1;
  } else {
    existing.count += 1;
    count = existing.count;
  }

  if (count > limit) {
    // 回滚
    if (existing) existing.count -= 1;
    logger.warn(
      { userId: user.id, plan: user.plan_type, count, limit },
      '用户超过 LLM 日配额'
    );
    res.status(429).json({
      code: 429,
      message: `今日 LLM 调用已达上限(${limit} 次/天)。可明天再试或升级到 Pro 计划。`,
      data: getQuotaSnapshot(user.id, user.plan_type),
    });
    return;
  }
  next();
}

/** 测试辅助:重置计数器 */
export function _resetQuotaCountersForTest(): void {
  _counters.clear();
}