/**
 * 插件 API 路由 - /api/v1/plugins
 *
 * GET  /        列出已注册插件(供 Settings 页展示)
 * GET  /:id     单个插件详情
 *
 * v1.7.1 FR-13:
 *   提供插件元信息查询,给设置页/落地页 UI 展示"当前用哪个生成器"。
 */
import { Router } from 'express';
import { asyncHandler, ok, fail } from './response.js';
import { getPlugin, listPlugins } from '../plugins/host.js';

export const pluginsRouter = Router();

pluginsRouter.get(
  '/',
  asyncHandler((_req, res) => {
    return ok(res, listPlugins());
  })
);

pluginsRouter.get(
  '/:id',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const p = getPlugin(req.params.id);
    if (!p) return fail(res, 404, '插件不存在', 404);
    return ok(res, p);
  })
);