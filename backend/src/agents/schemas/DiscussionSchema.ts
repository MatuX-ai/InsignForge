/**
 * 讨论梳理画布 - 每轮 LLM 输出 Schema
 *
 * LLM 扮演"结构化梳理顾问",每轮输出:
 *   - reply: 面向用户的自然语言回应(提炼小结 / 追问关键问题 / 指出矛盾)
 *   - operations: 对画布的操作(新增 / 修改 / 删除 / 移动要点,增删重组分组)
 *
 * 服务端对 operations 做确定性应用(非法操作跳过),保证画布结构永远合法。
 */
import { z } from 'zod';

export const CanvasPointStatusSchema = z.enum(['draft', 'confirmed', 'question']);

export const DiscussionOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_point'),
    group_id: z.string().min(1),
    text: z.string().min(1).max(500),
    note: z.string().max(500).optional(),
    status: CanvasPointStatusSchema.optional(),
  }),
  z.object({
    op: z.literal('update_point'),
    point_id: z.string().min(1),
    text: z.string().min(1).max(500).optional(),
    status: CanvasPointStatusSchema.optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    op: z.literal('delete_point'),
    point_id: z.string().min(1),
  }),
  z.object({
    op: z.literal('move_point'),
    point_id: z.string().min(1),
    to_group_id: z.string().min(1),
  }),
  z.object({
    op: z.literal('add_group'),
    title: z.string().min(1).max(50),
  }),
  z.object({
    op: z.literal('rename_group'),
    group_id: z.string().min(1),
    title: z.string().min(1).max(50),
  }),
  z.object({
    op: z.literal('delete_group'),
    group_id: z.string().min(1),
  }),
]);

export const DiscussionTurnSchema = z
  .object({
    reply: z.string().min(1),
    operations: z.array(DiscussionOperationSchema).max(20),
  })
  /**
   * 描述作为 retryMetrics 的 fallback schemaName:
   *   若调用方忘记传 schemaName,这里会 fallback 到 "DiscussionTurn",
   *   比 "unknown" 更可读,便于运维定位。
   * 实际生产中调用方都已传具体 schemaName(DiscussionChatResponse / DiscussionOrganizeResponse),
   * 这个 describe 只是保险措施。
   */
  .describe('DiscussionTurn');

export type DiscussionTurn = z.infer<typeof DiscussionTurnSchema>;
