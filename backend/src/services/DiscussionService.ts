/**
 * 讨论梳理画布服务
 *
 * 职责:
 *   1. 讨论会话 CRUD(创建 / 查询 / 列表 / 删除)
 *   2. 每轮讨论: 追加用户消息 → 调用 LLM 输出 { reply, operations } → 确定性应用 operations 到画布 → 持久化
 *   3. 手动编辑: 前端增删改/重组画布时复用同一套 applyOps
 *
 * 设计:
 *   - LLM 输出的是"操作指令"而非完整画布,服务端校验后逐条应用,非法操作跳过,
 *     保证画布结构永远合法(引用不存在的 id 不会导致崩溃)
 *   - 异步任务用内存 Map 维护(与 BusinessPlanService 同模式),进程重启后任务丢失,会话数据仍在库中
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { chatJson, chatComplete, chatWithTools } from './llm/LLMClient.js';
import type { ChatMessage, ChatTool } from './llm/LLMClient.js';
import { DiscussionResearch } from './DiscussionResearch.js';
import { logger } from '../logger.js';
import {
  DISCUSSION_FACILITATOR_SYSTEM,
  DISCUSSION_TOOL_HINT,
  DISCUSSION_ORGANIZE_SYSTEM,
  MODE_GROUP_SUGGESTIONS,
  buildDiscussionUserPrompt,
  buildOrganizePrompt,
} from '../agents/prompts/discussionFacilitator.js';
import { DiscussionTurnSchema } from '../agents/schemas/DiscussionSchema.js';
import type {
  DiscussionCanvas,
  DiscussionChatJob,
  DiscussionMessage,
  DiscussionMode,
  DiscussionOp,
  DiscussionSession,
} from '../types/index.js';

interface DiscussionRow {
  id: string;
  project_id: string | null;
  title: string;
  mode: string;
  canvas: string;
  messages: string;
  created_at: string;
  updated_at: string;
}

/** 画布规模上限,防止会话无限膨胀 */
const MAX_GROUPS = 20;
const MAX_POINTS = 200;

/** 单条【调研数据】持久化上限(字符),防止大段市场数据撑爆会话历史与后续 prompt */
const MAX_PERSIST_DATA = 6000;

/** 讨论 AI 可调用的营销调研工具(与 DiscussionResearch 通道对应) */
const DISCUSSION_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'market_research',
      description:
        '对某个产品想法/领域做多源市场调研(搜索引擎+社区),返回市场热度、竞品线索、用户痛点等实时数据。当用户想法模糊、想验证"有没有人在做/有没有需求"时调用。',
      parameters: {
        type: 'object',
        properties: {
          idea: {
            type: 'string',
            description: '要调研的产品想法或领域,建议用收敛后的关键词表述',
          },
        },
        required: ['idea'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'competitor_analysis',
      description:
        '扫描某个领域的竞品画像,返回竞品名称/定位/优势/不足。当用户询问"谁在做/有哪些竞品/竞争格局"时调用。',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: '领域/品类关键词' },
          limit: { type: 'number', description: '返回竞品数量上限(默认 5)' },
        },
        required: ['domain'],
      },
    },
  },
];

/** 解析 LLM 返回的 JSON(兼容 ```json 包裹) */
function parseLlmJson(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}

/** 任务 Map: sessionId -> ChatJob */
const jobs = new Map<string, DiscussionChatJob>();
/** 整理任务 Map: sessionId -> ChatJob(与讨论任务分开,避免互相覆盖) */
const organizeJobs = new Map<string, DiscussionChatJob>();

/** 检查会话是否有任何运行中的异步任务(chat 或 organize),用于互斥 */
function hasRunningTask(sessionId: string): boolean {
  const chat = jobs.get(sessionId);
  if (chat?.status === 'running') return true;
  const org = organizeJobs.get(sessionId);
  if (org?.status === 'running') return true;
  return false;
}

function rowToSession(row: DiscussionRow): DiscussionSession {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    mode: row.mode as DiscussionMode,
    canvas: JSON.parse(row.canvas) as DiscussionCanvas,
    messages: JSON.parse(row.messages) as DiscussionMessage[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 深拷贝画布,应用操作时不影响内存中的引用 */
function cloneCanvas(canvas: DiscussionCanvas): DiscussionCanvas {
  return JSON.parse(JSON.stringify(canvas)) as DiscussionCanvas;
}

function findPoint(
  canvas: DiscussionCanvas,
  pointId: string
): { group: DiscussionCanvas['groups'][number]; index: number } | null {
  for (const group of canvas.groups) {
    const index = group.points.findIndex((p) => p.id === pointId);
    if (index >= 0) return { group, index };
  }
  return null;
}

/**
 * 确定性应用一组画布操作
 * 逐条执行,非法操作(引用不存在的 id、重复标题、超上限)静默跳过
 */
export function applyOps(canvas: DiscussionCanvas, ops: DiscussionOp[]): DiscussionCanvas {
  const next = cloneCanvas(canvas);
  const groups = next.groups;

  for (const op of ops) {
    switch (op.op) {
      case 'add_group': {
        const title = op.title.trim();
        if (!title) break;
        if (groups.length >= MAX_GROUPS) break;
        if (groups.some((g) => g.title === title)) break; // 避免重复分组
        groups.push({ id: randomUUID(), title, points: [] });
        break;
      }
      case 'rename_group': {
        const group = groups.find((g) => g.id === op.group_id);
        if (!group) break;
        group.title = op.title.trim();
        break;
      }
      case 'delete_group': {
        const idx = groups.findIndex((g) => g.id === op.group_id);
        if (idx >= 0) groups.splice(idx, 1);
        break;
      }
      case 'add_point': {
        const group = groups.find((g) => g.id === op.group_id);
        const text = op.text.trim();
        if (!group || !text) break;
        if (group.points.some((p) => p.text === text)) break; // 去重
        if (countPoints(next) >= MAX_POINTS) break;
        group.points.push({
          id: randomUUID(),
          text,
          status: op.status ?? 'draft',
          ...(op.note ? { note: op.note } : {}),
        });
        break;
      }
      case 'update_point': {
        const found = findPoint(next, op.point_id);
        if (!found) break;
        if (op.text !== undefined) {
          const text = op.text.trim();
          if (text) found.group.points[found.index]!.text = text;
        }
        if (op.status !== undefined) {
          found.group.points[found.index]!.status = op.status;
        }
        if (op.note !== undefined) {
          const note = op.note.trim();
          if (note) {
            found.group.points[found.index]!.note = note;
          } else {
            delete found.group.points[found.index]!.note;
          }
        }
        break;
      }
      case 'delete_point': {
        const found = findPoint(next, op.point_id);
        if (found) found.group.points.splice(found.index, 1);
        break;
      }
      case 'move_point': {
        const found = findPoint(next, op.point_id);
        const target = groups.find((g) => g.id === op.to_group_id);
        if (!found || !target) break;
        if (found.group.id === target.id) break;
        const [point] = found.group.points.splice(found.index, 1);
        if (point) target.points.push(point);
        break;
      }
    }
  }

  return next;
}

function countPoints(canvas: DiscussionCanvas): number {
  return canvas.groups.reduce((sum, g) => sum + g.points.length, 0);
}

function persist(session: DiscussionSession): void {
  const db = getDb();
  db.prepare(
    `UPDATE discussion_sessions SET title = ?, mode = ?, canvas = ?, messages = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    session.title,
    session.mode,
    JSON.stringify(session.canvas),
    JSON.stringify(session.messages),
    session.id
  );
}

function now(): string {
  return new Date().toISOString();
}

/**
 * 从消息历史中排除最后一条匹配内容的用户消息
 * 用于 runChat 中构建 prompt 时排除本轮刚追加的消息,避免重复
 * 比 slice(0,-1) 更稳健:不依赖数组末尾位置,即使中间有其他操作也能正确定位
 */
function excludeLatestUserMessage(
  messages: DiscussionMessage[],
  content: string
): DiscussionMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' && m.content === content) {
      return messages.slice(0, i).concat(messages.slice(i + 1));
    }
  }
  return messages;
}

export const DiscussionService = {
  /** 创建会话;非 free 模式按模板预建分组骨架;可关联项目(报告页"进一步探讨") */
  create(input: {
    title?: string;
    mode?: DiscussionMode;
    projectId?: string;
    /** 内部使用: 自动发起的首条消息(创建后立即触发 AI 回复) */
    firstMessage?: string;
  }): DiscussionSession {
    const db = getDb();
    const id = randomUUID();
    const mode = input.mode ?? 'free';
    const suggestions = MODE_GROUP_SUGGESTIONS[mode];
    const groups = suggestions.map((title) => ({ id: randomUUID(), title, points: [] }));
    const title = input.title?.trim() || '未命名梳理';

    db.prepare(
      `INSERT INTO discussion_sessions (id, project_id, title, mode, canvas, messages) VALUES (?, ?, ?, ?, ?, '[]')`
    ).run(id, input.projectId ?? null, title, mode, JSON.stringify({ groups }));

    const session = this.getById(id)!;

    // 如果有 firstMessage,立即触发 AI 回复(用于"继续探讨"等场景)
    if (input.firstMessage) {
      this.chat(id, input.firstMessage);
    }

    return session;
  },

  /** 按 ID 获取会话 */
  getById(id: string): DiscussionSession | null {
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM discussion_sessions WHERE id = ?`)
      .get(id) as DiscussionRow | undefined;
    return row ? rowToSession(row) : null;
  },

  /** 列出最近会话 */
  list(limit = 50): DiscussionSession[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM discussion_sessions ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as DiscussionRow[];
    return rows.map(rowToSession);
  },

  /** 删除会话 */
  delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`DELETE FROM discussion_sessions WHERE id = ?`).run(id);
    jobs.delete(id);
    organizeJobs.delete(id);
    return result.changes > 0;
  },

  /** 手动应用一组画布操作(前端增删改/重组)并持久化 */
  applyOps(sessionId: string, ops: DiscussionOp[]): DiscussionSession | null {
    const session = this.getById(sessionId);
    if (!session) return null;
    const next = applyOps(session.canvas, ops);
    session.canvas = next;
    persist(session);
    return session;
  },

  /**
   * 触发一轮讨论(异步): 追加用户消息 → 后台调 LLM → 应用操作并持久化
   * 同一会话有进行中的任务时复用该任务,避免并发写画布
   */
  chat(sessionId: string, message: string): DiscussionChatJob | null {
    const session = this.getById(sessionId);
    if (!session) return null;

    // 互斥: 有任何运行中的任务就拒绝(整理或讨论都算)
    if (hasRunningTask(sessionId)) {
      return jobs.get(sessionId) ?? organizeJobs.get(sessionId) ?? null;
    }

    // 用户消息先入库,保证失败时对话记录完整
    session.messages.push({ role: 'user', content: message, created_at: now() });
    persist(session);

    const job: DiscussionChatJob = {
      status: 'running',
      current_step: '正在梳理并更新画布...',
      started_at: now(),
      finished_at: null,
      error_code: null,
      error_message: null,
    };
    jobs.set(sessionId, job);

    void runChat(sessionId, message, job).catch((err) => {
      logger.error({ err, sessionId }, '讨论任务未捕获异常');
    });

    return job;
  },

  /** 获取一轮讨论的任务状态(前端轮询) */
  getChatStatus(sessionId: string): DiscussionChatJob | null {
    return jobs.get(sessionId) ?? null;
  },

  /**
   * 触发一次画布整理(异步): AI 对整张画布做去重/合并/归类
   * 与讨论任务独立,有进行中的整理时复用
   */
  organize(sessionId: string, instruction?: string): DiscussionChatJob | null {
    const session = this.getById(sessionId);
    if (!session) return null;

    // 互斥: 有任何运行中的任务就拒绝
    if (hasRunningTask(sessionId)) {
      return organizeJobs.get(sessionId) ?? jobs.get(sessionId) ?? null;
    }

    const job: DiscussionChatJob = {
      status: 'running',
      current_step: '正在整理画布(去重/合并/归类)...',
      started_at: now(),
      finished_at: null,
      error_code: null,
      error_message: null,
    };
    organizeJobs.set(sessionId, job);

    void runOrganize(sessionId, instruction ?? '', job).catch((err) => {
      logger.error({ err, sessionId }, '画布整理任务未捕获异常');
    });

    return job;
  },

  /** 获取画布整理任务状态 */
  getOrganizeStatus(sessionId: string): DiscussionChatJob | null {
    return organizeJobs.get(sessionId) ?? null;
  },
};

/** 后台执行一轮讨论(带营销调研工具调用) */
async function runChat(
  sessionId: string,
  message: string,
  job: DiscussionChatJob
): Promise<void> {
  try {
    const session = DiscussionService.getById(sessionId);
    if (!session) throw new Error('会话不存在');

    job.current_step = '正在提炼要点并重组画布...';

    // 历史排除本轮刚追加的用户消息(按内容 + 时间定位,不依赖数组末尾)
    const history = excludeLatestUserMessage(session.messages, message);

    // 组装对话: 系统提示(含工具说明) + 用户提示(画布/历史/本轮发言)
    const messages: ChatMessage[] = [
      { role: 'system', content: DISCUSSION_FACILITATOR_SYSTEM + DISCUSSION_TOOL_HINT },
      {
        role: 'user',
        content: buildDiscussionUserPrompt({
          mode: session.mode,
          canvas: session.canvas,
          history,
          userMessage: message,
        }),
      },
    ];

    // 第一轮: 带工具,让模型决定是否需要实时市场数据
    let rawContent = '';
    const toolDataMessages: string[] = [];
    const res = await chatWithTools(messages, DISCUSSION_TOOLS, {
      temperature: 0.5,
      maxTokens: 4096,
    });

    if (res.toolCalls.length === 0) {
      // 未调用工具: 期望直接输出 {reply, operations} JSON
      rawContent = res.content;
    } else {
      // 有工具调用: 执行工具,把结果回填
      job.current_step = '正在检索实时市场数据...';
      messages.push({
        role: 'assistant',
        content: res.content || null,
        tool_calls: res.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of res.toolCalls) {
        let resultText: string;
        try {
          const args = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
          if (tc.name === 'market_research') {
            const r = await DiscussionResearch.marketResearch(String(args.idea ?? ''));
            resultText = r.text;
          } else if (tc.name === 'competitor_analysis') {
            const r = await DiscussionResearch.competitorAnalysis(String(args.domain ?? ''));
            resultText = r.text;
          } else {
            resultText = `未知工具:${tc.name}`;
          }
        } catch (err) {
          resultText = `工具执行失败:${err instanceof Error ? err.message : String(err)}`;
        }
        toolDataMessages.push(resultText);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText });
      }

      // 最终答复: 用 jsonMode 强制 JSON,且不再附带 tools,避免模型继续对话或输出散文
      job.current_step = '正在整合调研数据生成结论...';
      rawContent = await chatComplete(messages, {
        jsonMode: true,
        temperature: 0.5,
        maxTokens: 4096,
      });
    }

    if (!rawContent) {
      throw new Error('AI 未能给出有效答复,请重试');
    }

    // 校验 LLM 输出结构(工具调用轮没有 jsonMode,手动解析)
    const parsed = DiscussionTurnSchema.safeParse(parseLlmJson(rawContent));
    if (!parsed.success) {
      logger.error(
        { err: parsed.error.format(), raw: rawContent },
        '讨论输出结构校验失败'
      );
      throw new Error(
        `AI 输出结构不符合预期:${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .slice(0, 3)
          .join('; ')}`
      );
    }

    const turn = parsed.data;
    const fresh = DiscussionService.getById(sessionId);
    if (!fresh) throw new Error('会话不存在');

    // 在最新画布上应用操作(避免覆盖并行的手动编辑)
    fresh.canvas = applyOps(fresh.canvas, turn.operations);
    // 工具采集到的市场数据作为一条 AI 消息写入对话,便于用户回溯数据来源;
    // 长度受限,避免多轮调研后大段数据撑爆会话历史与后续 prompt 上下文
    if (toolDataMessages.length > 0) {
      let dataMsg = `【调研数据】\n${toolDataMessages.join('\n\n')}`;
      if (dataMsg.length > MAX_PERSIST_DATA) {
        dataMsg = `${dataMsg.slice(0, MAX_PERSIST_DATA)}\n...(已截断,完整数据仅供当轮分析)`;
      }
      fresh.messages.push({
        role: 'assistant',
        content: dataMsg,
        created_at: now(),
      });
    }
    fresh.messages.push({ role: 'assistant', content: turn.reply, created_at: now() });
    persist(fresh);

    job.status = 'success';
    job.finished_at = now();
    job.current_step = '完成';
    logger.info(
      {
        sessionId,
        ops: turn.operations.length,
        points: countPoints(fresh.canvas),
        toolRounds: toolDataMessages.length > 0 ? 1 : 0,
      },
      '讨论回合完成'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.finished_at = now();
    job.error_message = msg;
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : null;
    job.error_code = code === 'MISSING_API_KEY' ? 'MISSING_API_KEY' : 'INTERNAL_ERROR';
    job.current_step = `失败:${msg}`;
    logger.error({ err: msg, sessionId }, '讨论回合失败');
  }
}

/** 后台执行画布整理 */
async function runOrganize(
  sessionId: string,
  instruction: string,
  job: DiscussionChatJob
): Promise<void> {
  try {
    const session = DiscussionService.getById(sessionId);
    if (!session) throw new Error('会话不存在');

    const totalPoints = session.canvas.groups.reduce((n, g) => n + g.points.length, 0);
    if (totalPoints === 0) {
      job.status = 'success';
      job.finished_at = now();
      job.current_step = '画布为空,无需整理';
      return;
    }

    job.current_step = '正在分析要点并整理画布...';

    const raw = await chatJson<unknown>(
      DISCUSSION_ORGANIZE_SYSTEM,
      buildOrganizePrompt({
        mode: session.mode,
        canvas: session.canvas,
        instruction,
      }),
      { temperature: 0.3, maxTokens: 4096 }
    );

    const parsed = DiscussionTurnSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { err: parsed.error.format(), raw: raw as string },
        '画布整理输出结构校验失败'
      );
      throw new Error(
        `AI 输出结构不符合预期:${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .slice(0, 3)
          .join('; ')}`
      );
    }

    const turn = parsed.data;
    const fresh = DiscussionService.getById(sessionId);
    if (!fresh) throw new Error('会话不存在');

    // 应用整理操作
    fresh.canvas = applyOps(fresh.canvas, turn.operations);
    // 整理结果作为一条 AI 消息写入对话历史,方便回溯
    fresh.messages.push({
      role: 'assistant',
      content: `【画布整理】${turn.reply}`,
      created_at: now(),
    });
    persist(fresh);

    job.status = 'success';
    job.finished_at = now();
    job.current_step = `整理完成:${turn.operations.length} 项操作`;
    logger.info(
      { sessionId, ops: turn.operations.length, points: countPoints(fresh.canvas) },
      '画布整理完成'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.finished_at = now();
    job.error_message = msg;
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : null;
    job.error_code = code === 'MISSING_API_KEY' ? 'MISSING_API_KEY' : 'INTERNAL_ERROR';
    job.current_step = `失败:${msg}`;
    logger.error({ err: msg, sessionId }, '画布整理失败');
  }
}
