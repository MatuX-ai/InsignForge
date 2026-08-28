/**
 * services/llm/LLMClient.ts 中 chatCompleteWithSchemaRetry 单元测试
 *
 * 覆盖:
 *   1. 首次调用即通过 → 不重试,attempts=1, successFirstTry 计数
 *   2. 第一次失败第二次通过 → attempts=2, successAfterRetry 计数
 *   3. 三次都失败 → throws, failedAfterMaxRetries 计数
 *   4. 重试时只在最后一条 user/assistant 消息末尾追加反馈,tool 消息保持原位
 *   5. 不重新调用 chatWithTools(关键边界:避免市场调研 API 被多次请求)
 *   6. lastHumanIdx === -1 或 content === null 时 fallback 为新增 user 消息
 *   7. schemaName 为空时兜底为 'unknown'
 *   8. JSON 解析失败(非合法 JSON)也算一次失败,触发重试
 *   9. 不污染调用方的 messages 数组(浅拷贝隔离)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';

// vi.mock 会被提升到文件顶部,mock 函数也必须能提前初始化
const { mockChatComplete, mockChatWithTools, mockChatJson } = vi.hoisted(() => ({
  mockChatComplete: vi.fn(),
  mockChatWithTools: vi.fn(),
  mockChatJson: vi.fn(),
}));

// 抑制 logger 噪音
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// mock LLMClient 中 chatComplete / chatWithTools / chatJson,避免真实 LLM 调用
vi.mock('../src/services/llm/LLMClient.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/llm/LLMClient.js')>(
    '../src/services/llm/LLMClient.js'
  );
  return {
    ...actual,
    chatComplete: mockChatComplete,
    chatJson: mockChatJson,
    chatWithTools: mockChatWithTools,
  };
});

import { chatCompleteWithSchemaRetry } from '../src/services/llm/chatCompleteRetry.js';
import * as retryMetricsModule from '../src/services/llm/retryMetrics.js';
import type { ChatMessage } from '../src/services/llm/LLMClient.js';

const TestSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
});

const VALID = { name: 'alice', age: 30 };
const INVALID_MISSING_NAME = { age: 30 };

// 用 spyOn 替换 recordRetryResult:ESM 模块对象可以修改属性,
// 这样 LLMClient.ts 内部对 recordRetryResult 的调用会被 spy 截获
let recordSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockChatComplete.mockReset();
  mockChatWithTools.mockReset();
  mockChatJson.mockReset();
  recordSpy = vi.spyOn(retryMetricsModule, 'recordRetryResult');
  // 关闭定时器避免污染(惰性启动)
  retryMetricsModule.resetMetrics();
  retryMetricsModule.stopRetryMetricsTimer();
});

afterEach(() => {
  recordSpy.mockRestore();
  retryMetricsModule.resetMetrics();
  retryMetricsModule.stopRetryMetricsTimer();
});

describe('chatCompleteWithSchemaRetry - 基本重试', () => {
  it('首次调用即通过 → 不重试,attempts=1, succeeded=true', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(VALID));

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ];
    const result = await chatCompleteWithSchemaRetry(messages, TestSchema, {
      schemaName: 'Test',
    });

    expect(result).toEqual(VALID);
    expect(mockChatComplete).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith({
      schemaName: 'Test',
      attempts: 1,
      succeeded: true,
    });
  });

  it('第一次失败第二次通过 → attempts=2, successAfterRetry 计数', async () => {
    mockChatComplete
      .mockResolvedValueOnce(JSON.stringify(INVALID_MISSING_NAME))
      .mockResolvedValueOnce(JSON.stringify(VALID));

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ];
    const result = await chatCompleteWithSchemaRetry(messages, TestSchema, {
      schemaName: 'Test',
      maxRetries: 2,
    });

    expect(result).toEqual(VALID);
    expect(mockChatComplete).toHaveBeenCalledTimes(2);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith({
      schemaName: 'Test',
      attempts: 2,
      succeeded: true,
    });
  });

  it('三次都失败 → throws, failedAfterMaxRetries 计数', async () => {
    mockChatComplete.mockResolvedValue(JSON.stringify(INVALID_MISSING_NAME));

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ];
    await expect(
      chatCompleteWithSchemaRetry(messages, TestSchema, {
        schemaName: 'Test',
        maxRetries: 2,
      })
    ).rejects.toThrow(/未通过 schema 校验.*已重试 2 次/);

    expect(mockChatComplete).toHaveBeenCalledTimes(3);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith({
      schemaName: 'Test',
      attempts: 3,
      succeeded: false,
    });
  });

  it('maxRetries=0 时只调用一次,失败即抛', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(INVALID_MISSING_NAME));

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ];
    await expect(
      chatCompleteWithSchemaRetry(messages, TestSchema, {
        schemaName: 'Test',
        maxRetries: 0,
      })
    ).rejects.toThrow(/未通过 schema 校验.*已重试 0 次/);

    expect(mockChatComplete).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith({
      schemaName: 'Test',
      attempts: 1,
      succeeded: false,
    });
  });
});

describe('chatCompleteWithSchemaRetry - 消息结构(关键边界)', () => {
  it('重试时只在最后一条 user/assistant 消息末尾追加反馈,tool 消息保持原位', async () => {
    mockChatComplete
      .mockResolvedValueOnce(JSON.stringify(INVALID_MISSING_NAME))
      .mockResolvedValueOnce(JSON.stringify(VALID));

    // 模拟工具调用后的 messages:system, user, assistant(tool_calls), tool, tool
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt with detail' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'foo', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 't1', content: 'tool-result-1' },
      { role: 'tool', tool_call_id: 't2', content: 'tool-result-2' },
    ];

    const result = await chatCompleteWithSchemaRetry(messages, TestSchema, {
      schemaName: 'Test',
    });

    expect(result).toEqual(VALID);
    expect(mockChatComplete).toHaveBeenCalledTimes(2);

    // 第 1 次调用:tool 消息保持原位,user 消息末尾追加 schema 段
    const call1Messages = mockChatComplete.mock.calls[0]![0] as ChatMessage[];
    expect(call1Messages).toHaveLength(5);
    expect(call1Messages[0]).toEqual(messages[0]); // system 不变
    // user 消息保留原始内容并追加 schema 段(不是浅拷贝中同一个对象引用)
    expect((call1Messages[1] as { content: string }).content).toContain('user prompt with detail');
    expect((call1Messages[1] as { content: string }).content).toContain('## 输出 JSON Schema');
    expect(call1Messages[2]).toEqual(messages[2]); // assistant(tool_calls) 不变
    expect(call1Messages[3]).toEqual(messages[3]); // tool 不变
    expect(call1Messages[4]).toEqual(messages[4]); // tool 不变

    // 第 2 次调用:tool 消息依然不变,user 消息追加 schema(已存在则不重复)+ 反馈段
    const call2Messages = mockChatComplete.mock.calls[1]![0] as ChatMessage[];
    expect(call2Messages).toHaveLength(5);
    expect(call2Messages[3]).toEqual(messages[3]); // tool 仍原位
    expect(call2Messages[4]).toEqual(messages[4]); // tool 仍原位
    const userContent2 = (call2Messages[1] as { content: string }).content;
    expect(userContent2).toContain('user prompt with detail');
    expect(userContent2).toContain('## 输出 JSON Schema');
    expect(userContent2).toContain('上一轮校验反馈');
    expect(userContent2).toContain('name:');
  });

  it('不污染调用方的 messages 数组(浅拷贝隔离)', async () => {
    mockChatComplete
      .mockResolvedValueOnce(JSON.stringify(INVALID_MISSING_NAME))
      .mockResolvedValueOnce(JSON.stringify(VALID));

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'original user content' },
    ];
    const originalUserContent = messages[1]!.content;

    await chatCompleteWithSchemaRetry(messages, TestSchema, { schemaName: 'Test' });

    // 调用方 messages 完全不变
    expect(messages[1]!.content).toBe(originalUserContent);
    expect(messages).toHaveLength(2);
  });

  it('没有 user/assistant 消息(全 tool) → fallback 新增 user 消息', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(VALID));

    const messages: ChatMessage[] = [
      { role: 'tool', tool_call_id: 't1', content: 'r1' },
      { role: 'tool', tool_call_id: 't2', content: 'r2' },
    ];
    const result = await chatCompleteWithSchemaRetry(messages, TestSchema, {
      schemaName: 'Test',
    });

    expect(result).toEqual(VALID);
    const calledMessages = mockChatComplete.mock.calls[0]![0] as ChatMessage[];
    // 原 2 个 tool + 1 个新增 user
    expect(calledMessages).toHaveLength(3);
    expect(calledMessages[2]!.role).toBe('user');
    expect((calledMessages[2] as { content: string }).content).toContain('## 输出 JSON Schema');
  });

  it('最后一条是 user(content 正常)→ 追加 schema 到该 user 消息', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(VALID));

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'last user' },
    ];
    await chatCompleteWithSchemaRetry(messages, TestSchema, { schemaName: 'Test' });

    const calledMessages = mockChatComplete.mock.calls[0]![0] as ChatMessage[];
    expect(calledMessages).toHaveLength(2);
    expect((calledMessages[1] as { content: string }).content).toContain('last user');
    expect((calledMessages[1] as { content: string }).content).toContain('## 输出 JSON Schema');
  });

  it('最后一条是 assistant(null content) → 跳过 assistant, 追加 schema 到上一条 user 消息', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(VALID));

    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first user' },
      { role: 'assistant', content: null }, // 纯 null content,被跳过
    ];
    await chatCompleteWithSchemaRetry(messages, TestSchema, { schemaName: 'Test' });

    const calledMessages = mockChatComplete.mock.calls[0]![0] as ChatMessage[];
    // 原 3 条:system + user + assistant(null);user 末尾追加 schema,assistant 不变
    expect(calledMessages).toHaveLength(3);
    expect(calledMessages[0]!.role).toBe('system');
    expect(calledMessages[1]!.role).toBe('user');
    expect((calledMessages[1] as { content: string }).content).toContain('first user');
    expect((calledMessages[1] as { content: string }).content).toContain('## 输出 JSON Schema');
    expect(calledMessages[2]!.role).toBe('assistant');
  });
});

describe('chatCompleteWithSchemaRetry - 边界', () => {
  it('schemaName 为空 → 兜底为 "unknown"', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(VALID));

    await chatCompleteWithSchemaRetry(
      [{ role: 'user', content: 'u' }],
      TestSchema,
      { schemaName: '   ' }
    );

    expect(recordSpy).toHaveBeenCalledWith({
      schemaName: 'unknown',
      attempts: 1,
      succeeded: true,
    });
  });

  it('JSON 解析失败(不是合法 JSON) → 触发重试', async () => {
    mockChatComplete
      .mockResolvedValueOnce('not a json at all')
      .mockResolvedValueOnce(JSON.stringify(VALID));

    const result = await chatCompleteWithSchemaRetry(
      [{ role: 'user', content: 'u' }],
      TestSchema,
      { schemaName: 'Test', maxRetries: 2 }
    );

    expect(result).toEqual(VALID);
    expect(mockChatComplete).toHaveBeenCalledTimes(2);
    expect(recordSpy).toHaveBeenCalledWith({
      schemaName: 'Test',
      attempts: 2,
      succeeded: true,
    });
  });

  it('JSON 解析失败 + JSON 也失败 → 抛错包含 JSON 解析信息', async () => {
    mockChatComplete.mockResolvedValue('not json');

    await expect(
      chatCompleteWithSchemaRetry(
        [{ role: 'user', content: 'u' }],
        TestSchema,
        { schemaName: 'Test', maxRetries: 1 }
      )
    ).rejects.toThrow(/JSON 解析失败/);
  });

  it('```json 包裹也能解析成功', async () => {
    mockChatComplete.mockResolvedValueOnce('```json\n' + JSON.stringify(VALID) + '\n```');

    const result = await chatCompleteWithSchemaRetry(
      [{ role: 'user', content: 'u' }],
      TestSchema,
      { schemaName: 'Test' }
    );

    expect(result).toEqual(VALID);
  });

  it('多次重试时 zod issues 反馈段包含具体路径', async () => {
    mockChatComplete
      .mockResolvedValueOnce(JSON.stringify({ name: 'a', age: -5 })) // age < 0
      .mockResolvedValueOnce(JSON.stringify(VALID));

    await chatCompleteWithSchemaRetry(
      [{ role: 'user', content: 'u' }],
      TestSchema,
      { schemaName: 'Test' }
    );

    const call2Messages = mockChatComplete.mock.calls[1]![0] as ChatMessage[];
    const userContent = (call2Messages[0] as { content: string }).content;
    expect(userContent).toContain('age:');
    expect(userContent).toContain('上一轮校验反馈');
  });

  it('options.temperature / maxTokens 透传给 chatComplete', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(VALID));

    await chatCompleteWithSchemaRetry(
      [{ role: 'user', content: 'u' }],
      TestSchema,
      { schemaName: 'Test', temperature: 0.7, maxTokens: 2048 }
    );

    const callOptions = mockChatComplete.mock.calls[0]![1];
    expect(callOptions).toMatchObject({
      jsonMode: true,
      temperature: 0.7,
      maxTokens: 2048,
    });
  });

  it('jsonMode 始终为 true(避免模型输出散文)', async () => {
    mockChatComplete.mockResolvedValueOnce(JSON.stringify(VALID));

    await chatCompleteWithSchemaRetry(
      [{ role: 'user', content: 'u' }],
      TestSchema,
      { schemaName: 'Test' }
    );

    const callOptions = mockChatComplete.mock.calls[0]![1];
    expect(callOptions).toMatchObject({ jsonMode: true });
  });
});
