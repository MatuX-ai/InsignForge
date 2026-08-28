/**
 * API 路由汇总
 */
import { Router } from 'express';
import { projectsRouter } from './projects.js';
import { researchRouter } from './research.js';
import { landingRouter } from './landing.js';
import { docsRouter } from './docs.js';
import { businessPlanRouter } from './business-plan.js';
import { techSelectionRouter } from './tech-selection.js';
import { frontendDesignRouter } from './frontend-design.js';
import { marketNeedsRouter } from './market-needs.js';
import { settingsRouter } from './settings.js';
import { discussionsRouter } from './discussions.js';
import { archivesRouter } from './archives.js';
import { adminRouter } from './admin.js';

export const apiRouter = Router();

apiRouter.use('/projects', projectsRouter);
// 子路由挂在同一前缀下,以便 /projects/:id/research 等
apiRouter.use('/projects/:id/research', researchRouter);
apiRouter.use('/projects/:id/landing', landingRouter);
apiRouter.use('/projects/:id/docs', docsRouter);
apiRouter.use('/projects/:id/business-plan', businessPlanRouter);
apiRouter.use('/projects/:id/tech-selection', techSelectionRouter);
apiRouter.use('/projects/:id/frontend-design', frontendDesignRouter);

apiRouter.use('/market-needs', marketNeedsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/discussions', discussionsRouter);
apiRouter.use('/archives', archivesRouter);
apiRouter.use('/admin', adminRouter);