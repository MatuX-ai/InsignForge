/**
 * 讨论梳理画布路由 - /api/v1/discussions
 *
 * POST   /                      创建会话(可选带首条消息直接开聊)
 * GET    /                      会话列表
 * GET    /:id                   获取会话(画布 + 对话)
 * DELETE /:id                   删除会话
 * POST   /:id/chat              触发一轮讨论(异步)
 * GET    /:id/chat/status       轮询讨论任务状态
 * POST   /:id/canvas/apply      手动应用画布操作(前端增删改/重组)
 */
import { Router } from 'express';
import { z } from 'zod';
import { DiscussionService } from '../services/DiscussionService.js';
import { DiscussionOperationSchema } from '../agents/schemas/DiscussionSchema.js';
import { asyncHandler, ok, fail } from './response.js';

export const discussionsRouter = Router();

/** 创建会话请求 */
const createSchema = z.object({
  title: z.string().max(100).optional(),
  mode: z.enum(['business_model', 'lean_canvas', 'swot', 'project', 'free']).optional(),
  message: z.string().min(1).max(2000).optional(),
  /** 关联的项目 ID(报告页"进一步探讨"等场景) */
  projectId: z.string().optional(),
  /** 内部使用: 创建后自动发起的首条消息,AI 会立即回复(用于"继续探讨"等场景) */
  firstMessage: z.string().max(500).optional(),
});

/** 触发讨论请求 */
const chatSchema = z.object({
  message: z.string().min(1).max(2000),
});

/** 手动画布操作请求 */
const applySchema = z.object({
  operations: z.array(DiscussionOperationSchema).max(50),
});

/** 创建会话(可选带首条消息) */
discussionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, '请求参数不合法');
    const { title, mode, message, projectId, firstMessage } = parsed.data;

    // 优先使用 firstMessage(内部场景),其次是 message(手动输入场景)
    const autoMsg = firstMessage ?? message;

    const session = DiscussionService.create({ title, mode, projectId, firstMessage: autoMsg });
    let job = null;
    // 只有手动输入的 message 才返回 job,firstMessage 是内部自动触发的
    if (message && !firstMessage) {
      job = DiscussionService.getChatStatus(session.id);
    }
    return ok(res, { session: DiscussionService.getById(session.id)!, job }, '已创建梳理会话');
  })
);

/** 会话列表 */
discussionsRouter.get(
  '/',
  asyncHandler((_req, res) => {
    return ok(res, DiscussionService.list());
  })
);

/** 获取单个会话 */
discussionsRouter.get(
  '/:id',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const session = DiscussionService.getById(req.params.id);
    if (!session) return fail(res, 404, '梳理会话不存在', 404);
    return ok(res, session);
  })
);

/** 删除会话 */
discussionsRouter.delete(
  '/:id',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const deleted = DiscussionService.delete(req.params.id);
    if (!deleted) return fail(res, 404, '梳理会话不存在', 404);
    return ok(res, null, '已删除');
  })
);

/** 触发一轮讨论 */
discussionsRouter.post(
  '/:id/chat',
  asyncHandler<{ params: { id: string }; body: unknown }>(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, '消息不能为空');

    const job = DiscussionService.chat(req.params.id, parsed.data.message);
    if (!job) return fail(res, 404, '梳理会话不存在', 404);
    return ok(res, job, '已启动讨论');
  })
);

/** 轮询讨论任务状态 */
discussionsRouter.get(
  '/:id/chat/status',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const job = DiscussionService.getChatStatus(req.params.id);
    if (!job) return fail(res, 404, '当前没有进行中的讨论任务', 404);
    return ok(res, job);
  })
);

/** 手动应用画布操作(增删改要点 / 重组分组) */
discussionsRouter.post(
  '/:id/canvas/apply',
  asyncHandler<{ params: { id: string }; body: unknown }>((req, res) => {
    const parsed = applySchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, '画布操作不合法');

    const session = DiscussionService.applyOps(req.params.id, parsed.data.operations);
    if (!session) return fail(res, 404, '梳理会话不存在', 404);
    return ok(res, session, '画布已更新');
  })
);

/** 触发画布整理(异步,AI 去重/合并/归类) */
const organizeSchema = z.object({
  instruction: z.string().max(500).optional(),
});

discussionsRouter.post(
  '/:id/organize',
  asyncHandler<{ params: { id: string }; body: unknown }>(async (req, res) => {
    const parsed = organizeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, '请求参数不合法');

    const job = DiscussionService.organize(req.params.id, parsed.data.instruction);
    if (!job) return fail(res, 404, '梳理会话不存在', 404);
    return ok(res, job, '已启动画布整理');
  })
);

/** 轮询画布整理任务状态 */
discussionsRouter.get(
  '/:id/organize/status',
  asyncHandler<{ params: { id: string } }>((req, res) => {
    const job = DiscussionService.getOrganizeStatus(req.params.id);
    if (!job) return fail(res, 404, '当前没有进行中的整理任务', 404);
    return ok(res, job);
  })
);
