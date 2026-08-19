/**
 * 统一 API 响应辅助
 */
import type { ApiResponse } from '../types/index.js';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export function ok<T>(res: Response, data?: T, message = 'success'): void {
  const body: ApiResponse<T> = { code: 0, message, data };
  res.json(body);
}

export function fail(res: Response, code: number, message: string, status = 400): void {
  const body: ApiResponse = { code, message };
  res.status(status).json(body);
}

export function serverError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  fail(res, 500, message, 500);
}

/**
 * 异步路由包装器,自动捕获异常
 * 使用 unknown 中转避免 Request<R> 转换错误
 */
export function asyncHandler<R extends Record<string, unknown> = Record<string, unknown>>(
  fn: (req: R, res: Response, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as unknown as R, res, next)).catch(next);
  };
}