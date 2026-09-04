/**
 * services/DiscussionService.ts 单元测试
 *
 * 覆盖:
 *   - applyOps 的确定性行为(纯函数,不依赖 DB / LLM):
 *       分组: 新增 / 重命名 / 删除 / 标题去重
 *       要点: 新增(同组文本去重) / 修改 / 删除 / 移动
 *       容错: 引用不存在的 id 的操作被跳过,画布不受影响
 *       规模上限: MAX_GROUPS / MAX_POINTS 生效
 *   - runChat / runOrganize 的集成测试(下轮 retry 设计):
 *       未调用工具 → chatJsonWithSchemaRetry 被调用 1 次
 *       调用工具 → chatWithTools 1 次 + chatCompleteWithSchemaRetry 1 次,工具被调用 N 次
 *       重试时工具不重复调用(关键边界)
 *       LLM 返回非法 → retry 后成功 / 最终失败时 job 进入 failed
 *
 * Mock 策略:
 *   - LLMClient.js → 三个函数都 vi.fn() 控制返回值
 *   - DiscussionResearch.js → 市场调研/竞品分析接口 mock,避免实际 HTTP 请求
 *   - db/index.js → 内存 Map 模拟 getDb,记录 persist 写入
 *   - logger.js → 静默
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks 必须在 import DiscussionService 之前 ===
vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// 内存 db mock: 支持 getById / persist(INSERT/UPDATE)
// 注意 DiscussionService 内部 rowToSession 会 JSON.parse(row.canvas) 和 row.messages,
// 所以 mock 必须返回 DB 行格式(JSON 字符串),不能直接返回 Session 对象
//
// persist 调用 UPDATE statement,包含 5 个参数:(title, mode, canvas, messages, id)
// mock 必须捕获这些参数并更新 store
const sessionRowsStore = new Map<string, Record<string, unknown>>();
vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('UPDATE')) {
        return {
          run: (
            title: string,
            mode: string,
            canvas: string,
            messages: string,
            id: string
          ) => {
            const row = sessionRowsStore.get(id);
            if (!row) return { changes: 0 };
            row.title = title;
            row.mode = mode;
            row.canvas = canvas;
            row.messages = messages;
            row.updated_at = new Date().toISOString();
            return { changes: 1 };
          },
        };
      }
      if (trimmed.startsWith('SELECT')) {
        return {
          get: (id: string) => sessionRowsStore.get(id),
          all: () => Array.from(sessionRowsStore.values()),
        };
      }
      // INSERT/DELETE 等其他语句,默认 no-op
      return {
        run: () => ({ changes: 1 }),
        get: () => undefined,
        all: () => [],
      };
    },
  }),
}));

// DiscussionResearch mock: 预设置返回数据,验证调用次数
const mockMarketResearch = vi.fn();
const mockCompetitorAnalysis = vi.fn();
vi.mock('../src/services/DiscussionResearch.js', () => ({
  DiscussionResearch: {
    marketResearch: (...args: unknown[]) => mockMarketResearch(...args),
    competitorAnalysis: (...args: unknown[]) => mockCompetitorAnalysis(...args),
  },
}));

// LLMClient mock: 三个函数都返回 vi.fn(),让测试自由控制
const mockChatWithTools = vi.fn();
const mockChatJsonWithSchemaRetry = vi.fn();
const mockChatCompleteWithSchemaRetry = vi.fn();
vi.mock('../src/services/llm/LLMClient.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/llm/LLMClient.js')>(
    '../src/services/llm/LLMClient.js'
  );
  return {
    ...actual,
    chatWithTools: (...args: unknown[]) => mockChatWithTools(...args),
    chatJsonWithSchemaRetry: (...args: unknown[]) => mockChatJsonWithSchemaRetry(...args),
    chatCompleteWithSchemaRetry: (...args: unknown[]) =>
      mockChatCompleteWithSchemaRetry(...args),
  };
});

import { applyOps, DiscussionService } from '../src/services/DiscussionService.js';
import type {
  DiscussionCanvas,
  DiscussionSession,
} from '../src/types/index.js';
import type { ChatMessage, ChatWithToolsResult } from '../src/services/llm/LLMClient.js';

const emptyCanvas: DiscussionCanvas = { groups: [] };

beforeEach(() => {
  sessionRowsStore.clear();
  mockMarketResearch.mockReset();
  mockCompetitorAnalysis.mockReset();
  mockChatWithTools.mockReset();
  mockChatJsonWithSchemaRetry.mockReset();
  mockChatCompleteWithSchemaRetry.mockReset();
  // 默认 marketResearch 返回文本(测试可覆写)
  mockMarketResearch.mockResolvedValue({ text: 'mocked market data' });
  mockCompetitorAnalysis.mockResolvedValue({ text: 'mocked competitor data' });
});

afterEach(() => {
  vi.clearAllMocks();
});

/** 快速创建并入库一个会话(写入 DB 行格式,JSON.stringify canvas/messages) */
function seedSession(opts?: {
  id?: string;
  mode?: DiscussionSession['mode'];
  canvas?: DiscussionCanvas;
  messages?: DiscussionSession['messages'];
}): DiscussionSession {
  const id = opts?.id ?? 'sess-1';
  const canvas = opts?.canvas ?? emptyCanvas;
  const messages = opts?.messages ?? [];
  const row: Record<string, unknown> = {
    id,
    project_id: null,
    title: '测试会话',
    mode: opts?.mode ?? 'free',
    canvas: JSON.stringify(canvas),
    messages: JSON.stringify(messages),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  sessionRowsStore.set(id, row);
  return {
    id,
    project_id: null,
    title: row.title as string,
    mode: row.mode as DiscussionSession['mode'],
    canvas,
    messages,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** 等待 fire-and-forget 异步任务完成 */
async function waitForJobDone(
  getStatus: () => { status: string } | null,
  timeoutMs = 2000
): Promise<{ status: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getStatus();
    if (job && (job.status === 'success' || job.status === 'failed')) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job did not finish in time');
}

describe('runChat - 未调用工具路径', () => {
  it('LLM 合法输出 → applyOps 应用 + reply 写入消息,success', async () => {
    const session = seedSession({
      canvas: emptyCanvas,
      messages: [{ role: 'user', content: '之前的提问', created_at: '2026-08-28T00:00:00Z' }],
    });

    // 注意:必须在 chat() 之前设置 mockResolvedValueOnce。
    // chat() 是 fire-and-forget 异步任务,启动后立即 await chatWithTools,
    // 若 mock 队列为空,会返回 undefined,导致 res.toolCalls 报 TypeError。
    mockChatWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [],
    } as ChatWithToolsResult);
    // chatJsonWithSchemaRetry 返回解析后的对象
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      reply: 'AI 的回答',
      operations: [{ op: 'add_group', title: '新分组' }],
    });

    const job = DiscussionService.chat(session.id, '追加问题');
    expect(job).not.toBeNull();

    const done = await waitForJobDone(() => DiscussionService.getChatStatus(session.id));
    expect(done.status).toBe('success');

    expect(mockChatWithTools).toHaveBeenCalledTimes(1);
    expect(mockChatJsonWithSchemaRetry).toHaveBeenCalledTimes(1);
    expect(mockChatCompleteWithSchemaRetry).not.toHaveBeenCalled();
  });
});

describe('runChat - 调用工具路径(关键边界)', () => {
  it('chatWithTools 调用 1 次 + 工具执行 1 次 + chatCompleteWithSchemaRetry 1 次', async () => {
    const session = seedSession({ canvas: emptyCanvas });

    mockChatWithTools.mockResolvedValueOnce({
      content: '',
      toolCalls: [
        {
          id: 'tc1',
          name: 'market_research',
          arguments: JSON.stringify({ idea: 'AI 笔记应用' }),
        },
      ],
    } as ChatWithToolsResult);
    // 最终 JSON 轮:chatCompleteWithSchemaRetry 返回解析后对象
    mockChatCompleteWithSchemaRetry.mockResolvedValueOnce({
      reply: '调研完成',
      operations: [{ op: 'add_group', title: '调研发现' }],
    });

    const job = DiscussionService.chat(session.id, '帮我调研 AI 笔记');
    expect(job).not.toBeNull();

    const done = await waitForJobDone(() => DiscussionService.getChatStatus(session.id));
    expect(done.status).toBe('success');

    // 关键边界:chatWithTools 和工具都只调用 1 次
    expect(mockChatWithTools).toHaveBeenCalledTimes(1);
    expect(mockMarketResearch).toHaveBeenCalledTimes(1);
    expect(mockMarketResearch).toHaveBeenCalledWith(
      'AI 笔记应用',
      expect.objectContaining({ onStep: expect.any(Function) })
    );
    expect(mockChatCompleteWithSchemaRetry).toHaveBeenCalledTimes(1);
    // 传入 chatCompleteWithSchemaRetry 的 messages 应包含工具调用轮的所有消息
    const passedMessages = mockChatCompleteWithSchemaRetry.mock.calls[0]![0] as ChatMessage[];
    expect(passedMessages.length).toBeGreaterThanOrEqual(4); // system, user, assistant(tool_calls), tool
    expect(passedMessages.some((m) => m.role === 'tool')).toBe(true);
    expect(passedMessages.some((m) => m.role === 'tool' && m.content === 'mocked market data')).toBe(
      true
    );
  });

  it('chatCompleteWithSchemaRetry 传入的 messages 中 tool 消息保持原位', async () => {
    const session = seedSession({ canvas: emptyCanvas });

    mockChatWithTools.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        { id: 'tc1', name: 'market_research', arguments: '{"idea":"X"}' },
        { id: 'tc2', name: 'competitor_analysis', arguments: '{"domain":"X"}' },
      ],
    } as ChatWithToolsResult);
    mockChatCompleteWithSchemaRetry.mockResolvedValueOnce({
      reply: 'ok',
      operations: [],
    });

    DiscussionService.chat(session.id, '调研');
    await waitForJobDone(() => DiscussionService.getChatStatus(session.id));

    const passedMessages = mockChatCompleteWithSchemaRetry.mock.calls[0]![0] as ChatMessage[];
    // 系统 + 用户 + 助手(tool_calls) + 2 个工具消息 = 5
    expect(passedMessages).toHaveLength(5);
    expect(passedMessages[0]!.role).toBe('system');
    expect(passedMessages[1]!.role).toBe('user');
    expect(passedMessages[2]!.role).toBe('assistant');
    expect(passedMessages[3]!.role).toBe('tool');
    expect(passedMessages[4]!.role).toBe('tool');
    expect((passedMessages[2] as { tool_calls?: unknown }).tool_calls).toBeDefined();
  });

  it('chatCompleteWithSchemaRetry 失败 → job 进入 failed,工具仍只调用 1 次(不重复跑)', async () => {
    const session = seedSession({ canvas: emptyCanvas });

    mockChatWithTools.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        { id: 'tc1', name: 'market_research', arguments: '{"idea":"X"}' },
      ],
    } as ChatWithToolsResult);
    // chatCompleteWithSchemaRetry 在内部已经重试完毕仍失败(模拟生产错误)
    mockChatCompleteWithSchemaRetry.mockRejectedValueOnce(
      new Error('LLM 输出未通过 schema 校验(已重试 2 次):根原因')
    );

    DiscussionService.chat(session.id, '调研');
    const done = await waitForJobDone(() => DiscussionService.getChatStatus(session.id));

    expect(done.status).toBe('failed');
    // 关键边界:即使最终失败,工具也只调用 1 次(不在 retry 链中重复)
    expect(mockMarketResearch).toHaveBeenCalledTimes(1);
    expect(mockChatCompleteWithSchemaRetry).toHaveBeenCalledTimes(1);
  });

  it('多个工具调用并行执行并按原始顺序回填结果', async () => {
    const session = seedSession({ canvas: emptyCanvas });

    mockChatWithTools.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        { id: 'tc1', name: 'market_research', arguments: '{"idea":"idea"}' },
        { id: 'tc2', name: 'competitor_analysis', arguments: '{"domain":"domain"}' },
      ],
    } as ChatWithToolsResult);
    mockChatCompleteWithSchemaRetry.mockResolvedValueOnce({
      reply: 'ok',
      operations: [],
    });

    DiscussionService.chat(session.id, 'q');
    await waitForJobDone(() => DiscussionService.getChatStatus(session.id));

    expect(mockMarketResearch).toHaveBeenCalledTimes(1);
    expect(mockMarketResearch).toHaveBeenCalledWith(
      'idea',
      expect.objectContaining({ onStep: expect.any(Function) })
    );
    expect(mockCompetitorAnalysis).toHaveBeenCalledTimes(1);
    expect(mockCompetitorAnalysis).toHaveBeenCalledWith(
      'domain',
      expect.objectContaining({ onStep: expect.any(Function) })
    );
  });
});

describe('runOrganize - 重试路径', () => {
  it('LLM 合法输出 → applyOps + reply 写入消息', async () => {
    const canvas: DiscussionCanvas = {
      groups: [{ id: 'g1', title: 'G', points: [{ id: 'p1', text: 'point', status: 'draft' }] }],
    };
    const session = seedSession({ canvas });

    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      reply: '整理完成',
      operations: [{ op: 'rename_group', group_id: 'g1', title: 'G2' }],
    });

    const job = DiscussionService.organize(session.id, '帮我整理');
    expect(job).not.toBeNull();

    const done = await waitForJobDone(() => DiscussionService.getOrganizeStatus(session.id));
    expect(done.status).toBe('success');

    expect(mockChatJsonWithSchemaRetry).toHaveBeenCalledTimes(1);
    // 画布应该已经更新
    const updated = sessionRowsStore.get(session.id);
    expect(JSON.parse(updated!.canvas as string)).toMatchObject({
      groups: [{ id: 'g1', title: 'G2' }],
    });
  });

  it('画布为空 → 直接 success,LLM 不被调用', async () => {
    const session = seedSession({ canvas: emptyCanvas });

    const job = DiscussionService.organize(session.id, '');
    expect(job).not.toBeNull();

    const done = await waitForJobDone(() => DiscussionService.getOrganizeStatus(session.id));
    expect(done.status).toBe('success');
    expect(done.current_step).toMatch(/画布为空/);
    expect(mockChatJsonWithSchemaRetry).not.toHaveBeenCalled();
  });

  it('LLM 连续失败 → job 进入 failed,失败信息透传', async () => {
    const canvas: DiscussionCanvas = {
      groups: [{ id: 'g1', title: 'G', points: [{ id: 'p1', text: 'point', status: 'draft' }] }],
    };
    const session = seedSession({ canvas });

    mockChatJsonWithSchemaRetry.mockRejectedValueOnce(
      new Error('LLM 输出未通过 schema 校验(已重试 2 次):根因')
    );

    DiscussionService.organize(session.id, 'q');
    const done = await waitForJobDone(() => DiscussionService.getOrganizeStatus(session.id));

    expect(done.status).toBe('failed');
    expect(done.error_message).toMatch(/未通过 schema 校验/);
  });

  it('MISSING_API_KEY 错误码正确映射', async () => {
    const canvas: DiscussionCanvas = {
      groups: [{ id: 'g1', title: 'G', points: [{ id: 'p1', text: 'point', status: 'draft' }] }],
    };
    const session = seedSession({ canvas });

    const err = new Error('未配置 deepseek 的 API Key') as Error & { code?: string };
    err.code = 'MISSING_API_KEY';
    mockChatJsonWithSchemaRetry.mockRejectedValueOnce(err);

    DiscussionService.organize(session.id, 'q');
    const done = await waitForJobDone(() => DiscussionService.getOrganizeStatus(session.id));

    expect(done.status).toBe('failed');
    expect(done.error_code).toBe('MISSING_API_KEY');
  });
});

describe('applyOps - 分组操作', () => {
  it('add_group 追加分组', () => {
    const c = applyOps(emptyCanvas, [{ op: 'add_group', title: '目标用户' }]);
    expect(c.groups).toHaveLength(1);
    expect(c.groups[0]!.title).toBe('目标用户');
    expect(c.groups[0]!.points).toEqual([]);
    expect(c.groups[0]!.id).toBeTruthy();
  });

  it('add_group 相同标题去重', () => {
    const once = applyOps(emptyCanvas, [{ op: 'add_group', title: '痛点' }]);
    const twice = applyOps(once, [{ op: 'add_group', title: '痛点' }]);
    expect(twice.groups).toHaveLength(1);
  });

  it('rename_group 修改标题,无效 id 被跳过', () => {
    const c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'A' }]);
    const gid = c.groups[0]!.id;
    const renamed = applyOps(c, [{ op: 'rename_group', group_id: gid, title: 'B' }]);
    expect(renamed.groups[0]!.title).toBe('B');
    const skipped = applyOps(c, [{ op: 'rename_group', group_id: 'nope', title: 'C' }]);
    expect(skipped.groups[0]!.title).toBe('A');
  });

  it('delete_group 删除分组(连带要点)', () => {
    const c = applyOps(emptyCanvas, [
      { op: 'add_group', title: 'A' },
      { op: 'add_group', title: 'B' },
    ]);
    const gid = c.groups[0]!.id;
    const deleted = applyOps(c, [{ op: 'delete_group', group_id: gid }]);
    expect(deleted.groups).toHaveLength(1);
    expect(deleted.groups[0]!.title).toBe('B');
  });
});

describe('applyOps - 要点操作', () => {
  it('add_point 写入要点,默认状态 draft,同文本去重', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    c = applyOps(c, [
      { op: 'add_point', group_id: gid, text: '目标用户是独立开发者' },
      { op: 'add_point', group_id: gid, text: '目标用户是独立开发者' }, // 去重
      { op: 'add_point', group_id: gid, text: '痛点:缺时间验证想法', status: 'confirmed' },
    ]);
    expect(c.groups[0]!.points).toHaveLength(2);
    expect(c.groups[0]!.points[0]).toMatchObject({ text: '目标用户是独立开发者', status: 'draft' });
    expect(c.groups[0]!.points[1]).toMatchObject({ status: 'confirmed' });
  });

  it('update_point 修改文本/状态,并支持删除 note', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    c = applyOps(c, [{ op: 'add_point', group_id: gid, text: '旧内容', note: '备注' }]);
    const pid = c.groups[0]!.points[0]!.id;
    c = applyOps(c, [
      { op: 'update_point', point_id: pid, text: '新内容', status: 'question' },
      { op: 'update_point', point_id: pid, note: '' }, // 清空 note
    ]);
    expect(c.groups[0]!.points[0]).toMatchObject({ text: '新内容', status: 'question' });
    expect(c.groups[0]!.points[0]!.note).toBeUndefined();
  });

  it('delete_point 删除要点', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    c = applyOps(c, [{ op: 'add_point', group_id: gid, text: 'x' }]);
    const pid = c.groups[0]!.points[0]!.id;
    c = applyOps(c, [{ op: 'delete_point', point_id: pid }]);
    expect(c.groups[0]!.points).toHaveLength(0);
  });

  it('move_point 跨分组移动', () => {
    let c = applyOps(emptyCanvas, [
      { op: 'add_group', title: 'A' },
      { op: 'add_group', title: 'B' },
    ]);
    const [ga, gb] = c.groups.map((g) => g.id) as [string, string];
    c = applyOps(c, [{ op: 'add_point', group_id: ga, text: 'p' }]);
    const pid = c.groups[0]!.points[0]!.id;
    c = applyOps(c, [{ op: 'move_point', point_id: pid, to_group_id: gb }]);
    expect(c.groups[0]!.points).toHaveLength(0);
    expect(c.groups[1]!.points).toHaveLength(1);
    expect(c.groups[1]!.points[0]!.id).toBe(pid);
  });

  it('引用无效 id 的操作被静默跳过', () => {
    const c = applyOps(emptyCanvas, [
      { op: 'add_point', group_id: 'ghost', text: 'x' }, // 分组不存在
      { op: 'update_point', point_id: 'ghost', text: 'y' },
      { op: 'move_point', point_id: 'ghost', to_group_id: 'ghost' },
      { op: 'delete_point', point_id: 'ghost' },
    ]);
    expect(c.groups).toHaveLength(0);
  });
});

describe('applyOps - 规模上限', () => {
  it('分组数不超过 MAX_GROUPS(20)', () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      op: 'add_group' as const,
      title: `G${i}`,
    }));
    const c = applyOps(emptyCanvas, ops);
    expect(c.groups).toHaveLength(20);
  });

  it('要点总数不超过 MAX_POINTS(200)', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    const ops = Array.from({ length: 210 }, (_, i) => ({
      op: 'add_point' as const,
      group_id: gid,
      text: `point-${i}`,
    }));
    c = applyOps(c, ops);
    expect(c.groups[0]!.points).toHaveLength(200);
  });
});
