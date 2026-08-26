/**
 * 历史文档归档路由 - /api/v1/archives
 *
 * GET /  返回历史文档目录结构: { 项目名: { dir, files } }
 *       供历史记录页展示"该项目已生成哪些文档"(PDF 图标 / 胶囊入口)
 */
import { Router } from 'express';
import { asyncHandler, ok } from './response.js';
import { listHistoryDocs } from '../utils/archive.js';

export const archivesRouter = Router();

archivesRouter.get(
  '/',
  asyncHandler((_req, res) => {
    return ok(res, listHistoryDocs());
  })
);
