/**
 * 需求库路由(全局,非项目维度)
 * GET /api/v1/market-needs?keyword=xxx
 */
import { Router } from 'express';
import { MarketNeedService } from '../services/MarketNeedService.js';
import { asyncHandler, ok } from './response.js';

export const marketNeedsRouter = Router();

marketNeedsRouter.get(
  '/',
  asyncHandler<{ query: { keyword?: string } }>((req, res) => {
    const keyword = req.query.keyword?.trim();
    if (!keyword) {
      return ok(res, []);
    }
    const needs = MarketNeedService.search(keyword, 50);
    return ok(res, needs);
  })
);