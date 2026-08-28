/**
 * 管理/运维路由 - /api/v1/admin
 *
 * 当前提供:
 *   GET  /admin/llm-retry-metrics          查询各 schema 重试率快照
 *   POST /admin/llm-retry-metrics/reset    清空计数器(调试用)
 *
 * 设计:
 *   - 无鉴权(与 SettingsService / archives 路由保持一致;InsightForge 当前 MVP 阶段
 *     所有接口都跑在受信内网/本机环境,鉴权留待 v1.3 统一接入)
 *   - 计数器只读,前端/运维手动排查时调用即可
 *   - 业务响应统一走 response.ts 的 ok() 包装,保持与项目其他接口风格一致
 */
import { Router } from 'express';
import {
  getAllMetrics,
  resetMetrics,
  type SchemaRetryStats,
} from '../services/llm/retryMetrics.js';
import { asyncHandler, ok } from './response.js';

export const adminRouter = Router();

/** 指标快照响应(显式声明,便于前端对接) */
interface RetryMetricsResponse {
  metrics: SchemaRetryStats[];
  snapshotAt: string;
}

/**
 * 查询当前所有 schema 的重试率快照
 * 数组按 retryRate desc 排序,便于一眼定位异常 schema
 */
adminRouter.get(
  '/llm-retry-metrics',
  asyncHandler((_req, res) => {
    const body: RetryMetricsResponse = {
      metrics: getAllMetrics(),
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body);
  })
);

/**
 * 清空所有指标计数器(进程内)
 * 主要用于开发调试与集成测试,生产环境慎用
 */
adminRouter.post(
  '/llm-retry-metrics/reset',
  asyncHandler((_req, res) => {
    resetMetrics();
    const body: RetryMetricsResponse = {
      metrics: getAllMetrics(),
      snapshotAt: new Date().toISOString(),
    };
    return ok(res, body, '指标已清空');
  })
);
