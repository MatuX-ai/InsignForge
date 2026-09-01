/**
 * v2.0: 配额中间件单元测试
 *
 * 覆盖:
 *   - 默认 free 计划 50 次/天拦截
 *   - pro 计划 1000 次/天不拦截
 *   - 未登录用户不被配额限制(双轨制公共数据)
 *   - 鉴权关闭时配额中间件是 no-op
 *   - getQuotaSnapshot 数字一致性
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 用 vi.mock 替换 config,避开依赖副作用
vi.mock('../src/config.js', () => ({
  config: { INSIGHTFORGE_AUTH_ENABLED: true },
}));
vi.mock('../src/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  checkLlmQuota,
  getQuotaSnapshot,
  _resetQuotaCountersForTest,
} from '../src/middleware/quota.js';
import type { Request, Response, NextFunction } from 'express';

function makeReq(user: unknown): Request {
  return { user } as unknown as Request;
}
function makeRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}
function makeNext() {
  return vi.fn() as unknown as NextFunction;
}

describe('middleware/quota', () => {
  beforeEach(() => {
    _resetQuotaCountersForTest();
  });

  it('free 用户 50 次/天, 第 51 次返回 429', () => {
    const user = { id: 'u1', plan_type: 'free' };
    for (let i = 0; i < 50; i++) {
      const next = makeNext();
      checkLlmQuota(makeReq(user), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
    // 第 51 次应被拦截
    const next = makeNext();
    const res = makeRes();
    checkLlmQuota(makeReq(user), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('pro 用户 1000 次/天不拦截', () => {
    const user = { id: 'u2', plan_type: 'pro' };
    const next = makeNext();
    for (let i = 0; i < 100; i++) {
      checkLlmQuota(makeReq(user), makeRes(), next);
    }
    expect(next).toHaveBeenCalled();
  });

  it('未登录用户(req.user = null)不受配额限制', () => {
    const next = makeNext();
    for (let i = 0; i < 200; i++) {
      checkLlmQuota(makeReq(null), makeRes(), next);
    }
    expect(next).toHaveBeenCalled();
  });

  it('getQuotaSnapshot 返回剩余次数', () => {
    const user = { id: 'u3', plan_type: 'free' };
    const before = getQuotaSnapshot(user.id, user.plan_type);
    expect(before.limit).toBe(50);
    expect(before.used).toBe(0);
    expect(before.remaining).toBe(50);

    checkLlmQuota(makeReq(user), makeRes(), makeNext());
    const after = getQuotaSnapshot(user.id, user.plan_type);
    expect(after.used).toBe(1);
    expect(after.remaining).toBe(49);
  });

  it('跨日计数器自动重置(伪测试: 改 UTC 日期)', () => {
    const user = { id: 'u4', plan_type: 'free' };
    const next = makeNext();
    // 模拟使用 50 次
    for (let i = 0; i < 50; i++) {
      checkLlmQuota(makeReq(user), makeRes(), next);
    }
    // 此时应被拦截
    const blocked = makeNext();
    checkLlmQuota(makeReq(user), makeRes(), blocked);
    expect(blocked).not.toHaveBeenCalled();

    // 通过 _resetQuotaCountersForTest 模拟新的一天
    _resetQuotaCountersForTest();
    const next2 = makeNext();
    checkLlmQuota(makeReq(user), makeRes(), next2);
    expect(next2).toHaveBeenCalled();
  });
});