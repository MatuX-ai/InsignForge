/**
 * 带 schema 校验失败自动重试的多轮对话 JSON 收尾
 *
 * 适用场景:
 *   多轮工具调用 / 多轮对话后的最后一步 JSON 收尾(如 DiscussionService.runChat):
 *     [system, user, assistant(tool_calls), tool, tool] -> final JSON
 *   已经构建好 messages 数组,只需对最后一步做重试。
 *
 * 与 `chatJsonWithSchemaRetry` 的差异:
 *   - 输入是 messages 数组(非 system+user 二元组)
 *   - Schema 段不注入 system 末尾(可能没有 system,或 system 已被工具 hint 占满)
 *     而是在最后一条 user/assistant 消息的 content 末尾追加,tool 消息保持原位
 *   - 重试时把 zod 错误反馈拼到同一条消息末尾,不打断 tool_calls → tool 的对话结构
 *
 * 关键边界:
 *   - 不重新执行 chatWithTools / 工具调用(避免对市场调研 API 的重复请求)
 *   - 不丢失已持久化的工具结果消息
 *   - schemaName 由调用方显式传入,用于指标聚合
 *
 * 文件拆分原因:
 *   LLMClient.ts 中 `chatCompleteWithSchemaRetry` 与 `chatComplete` 同文件,
 *   函数体内调用 `chatComplete(...)` 是模块内调用,vi.mock 无法替换。
 *   拆到独立文件后,`chatComplete` 通过 import 绑定进入,
 *   测试可通过 vi.mock('../src/services/llm/LLMClient.js') 替换。
 */
import { ZodError, type ZodTypeAny } from 'zod';
import { chatComplete } from './LLMClient.js';
import type { ChatMessage } from './LLMClient.js';
import { logger } from '../../logger.js';
import { buildSchemaPromptSection } from './schemaPrompt.js';
import { recordRetryResult } from './retryMetrics.js';
import { formatRetryFeedback, makeJsonParseError } from './retryUtils.js';

export async function chatCompleteWithSchemaRetry<T>(
  messages: ChatMessage[],
  schema: ZodTypeAny,
  options: {
    jsonMode?: boolean; // 始终为 true,保留接口一致性
    temperature?: number;
    maxTokens?: number;
    timeoutSec?: number;
    /** schema 标识,用于指标聚合 key */
    schemaName?: string;
    /** 最大重试次数,默认 2(总共 3 次尝试) */
    maxRetries?: number;
  } = {}
): Promise<T> {
  const schemaName =
    options.schemaName?.trim() ||
    (typeof schema.description === 'string' ? schema.description : '') ||
    'unknown';
  const maxRetries = options.maxRetries ?? 2;

  // 找最后一条 content 是字符串的 user/assistant 消息索引(向后找,跳过 tool 和 null content)
  // 找不到时(-1)fallback 为 push 一条 user 消息
  let lastHumanIdx = messages.length - 1;
  while (
    lastHumanIdx >= 0 &&
    (messages[lastHumanIdx]?.role === 'tool' ||
      typeof messages[lastHumanIdx]?.content !== 'string')
  ) {
    lastHumanIdx--;
  }

  const schemaSection = buildSchemaPromptSection(schema, { schemaName });

  let lastError: ZodError | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;

    // 构造本轮 messages:浅拷贝避免污染调用方引用
    const workingMessages: ChatMessage[] = messages.map((m) => ({ ...m }));

    const feedbackText = lastError
      ? formatRetryFeedback(lastError, schemaName)
      : '';

    // 决定本轮追加到哪条消息:有 lastHumanIdx → 追加;否则 fallback 新增 user 消息
    if (lastHumanIdx >= 0) {
      const target = workingMessages[lastHumanIdx]!;
      const base = target.content as string; // 上面已保证 typeof === 'string'
      // 第 1 轮:只追加 schema;后续轮:追加 schema(若尚未注入)+ 反馈
      const alreadyHasSchema = base.includes('## 输出 JSON Schema');
      const extra = [alreadyHasSchema ? '' : schemaSection, feedbackText]
        .filter(Boolean)
        .join('\n\n');
      target.content = extra ? `${base}\n\n${extra}` : base;
    } else {
      // 兜底:在末尾追加一条 user 消息(部分 Provider 对 tool 后追加 user 兼容性参差,
      // 仅在完全找不到 user/assistant 时使用)
      const extra = [schemaSection, feedbackText].filter(Boolean).join('\n\n');
      workingMessages.push({ role: 'user', content: extra });
    }

    const raw = await chatComplete(workingMessages, {
      jsonMode: true,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      timeoutSec: options.timeoutSec,
    });

    // 容错:部分 Provider 会用 ```json 包裹
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '');

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      // JSON 解析失败也算一次失败,触发重试
      logger.warn(
        {
          attempt: attempt + 1,
          schemaName,
          err: err instanceof Error ? err.message : String(err),
          preview: cleaned.slice(0, 200),
        },
        'LLM 输出 JSON 解析失败'
      );
      lastError = makeJsonParseError(cleaned, err);
      if (attempt >= maxRetries) break;
      continue;
    }

    const validated = schema.safeParse(parsed);
    if (validated.success) {
      if (attempt > 0) {
        logger.info(
          { attempt: attempt + 1, schemaName },
          'LLM 输出经重试后通过 schema 校验'
        );
      }
      recordRetryResult({ schemaName, attempts, succeeded: true });
      return validated.data as T;
    }

    lastError = validated.error;
    logger.warn(
      {
        attempt: attempt + 1,
        schemaName,
        issueCount: validated.error.issues.length,
        sampleIssues: validated.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      'LLM 输出未通过 schema 校验'
    );
  }

  recordRetryResult({ schemaName, attempts, succeeded: false });
  const finalDetail = lastError
    ? lastError.issues
        .slice(0, 20)
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')
    : 'JSON 解析失败';
  throw new Error(
    `LLM 输出未通过 schema 校验(已重试 ${maxRetries} 次):${finalDetail}`
  );
}

// formatRetryFeedback / makeJsonParseError 已迁移到 ./retryUtils.ts,
// 与 chatJsonWithSchemaRetry 共享同一份反馈格式化逻辑,避免两处副本漂移。
