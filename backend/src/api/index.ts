/**
 * API 路由汇总
 */
import { Router } from 'express';
import { projectsRouter } from './projects.js';
import { researchRouter } from './research.js';
import { landingRouter } from './landing.js';
import { marketNeedsRouter } from './market-needs.js';
import { settingsRouter } from './settings.js';

export const apiRouter = Router();

apiRouter.use('/projects', projectsRouter);
// 子路由挂在同一前缀下,以便 /projects/:id/research 等
apiRouter.use('/projects/:id/research', researchRouter);
apiRouter.use('/projects/:id/landing', landingRouter);

apiRouter.use('/market-needs', marketNeedsRouter);
apiRouter.use('/settings', settingsRouter);