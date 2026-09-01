/**
 * LLM 客户端 - OpenAI 兼容协议
 *
 * 支持 DeepSeek / OpenAI / Ollama(本地),通过 config.LLM_PROVIDER 切换
 *
 * - DeepSeek:  https://api.deepseek.com  (deepseek-chat)
 * - OpenAI:    https://api.openai.com    (gpt-4o-mini 等)
 * - Ollama:    http://localhost:11434   (本地模型,无需 Key)
 */
import OpenAI from 'openai';
import { ZodError } from 'zod';
import type { ZodTypeAny } from 'zod';
import { getLlmBaseUrl } from '../../config.js';
import { logger } from '../../logger.js';
import {
  getCurrentProvider,
  getCurrentModel,
  resolveLlmApiKey,
} from '../SettingsService.js';
import { getLlmProvider } from './providers.js';
import { buildSchemaPromptSection } from './schemaPrompt.js';
import {
  recordRetryResult,
  recordCacheResultMetric,
} from './retryMetrics.js';
import { formatRetryFeedback } from './retryUtils.js';
import {
  type CacheMeta,
  getCachedOutput,
  setCachedOutput,
  makeCacheKey,
} from './cache.js';

/**
 * 缺少 LLM API Key 时抛出的专用错误
 * 用于上层统一识别并提示用户去设置页面配置
 */
export class MissingLlmApiKeyError extends Error {
  readonly code = 'MISSING_API_KEY';
  readonly provider: string;

  constructor(provider: string) {
    super(
      `未配置 ${provider} 的 API Key,请前往「设置」页面填写,或在后端 .env 中配置对应环境变量后重启服务`
    );
    this.name = 'MissingLlmApiKeyError';
    this.provider = provider;
  }
}

let _client: OpenAI | null = null;
let _clientProvider: string | null = null;

/**
 * 获取 OpenAI 兼容客户端(单例)
 * provider 切换时会自动重建单例
 */
function getClient(): OpenAI {
  const provider = getCurrentProvider();
  if (_client && _clientProvider === provider) return _client;

  // provider 变化,丢弃旧单例
  _client = null;
  _clientProvider = provider;

  const meta = getLlmProvider(provider);
  const requiresKey = meta?.requiresKey !== false; // 默认为 true

  const apiKey = resolveLlmApiKey();
  if (requiresKey && !apiKey) {
    logger.warn(
      { provider },
      `${provider} 未配置 API Key,LLM 调用将失败`
    );
    // 立即抛出,避免后续使用占位 key 浪费时间并污染日志
    throw new MissingLlmApiKeyError(provider);
  }

  _client = new OpenAI({
    apiKey: apiKey || 'sk-placeholder',
    baseURL: getLlmBaseUrl(),
    timeout: 60_000,
  });

  return _client;
}

/**
 * 默认思考模式控制:某些 Provider(如 DeepSeek V4)默认开启思考且会把 content 写入
 * reasoning_content,导致 JSON 解析失败。通过 providers.ts 中标记 supportsThinkingDisable
 * 的 provider,统一使用 extra_body.thinking.type='disabled' 关闭。
 * 其他 Provider(Qwen / GLM / Kimi / Yi)的思考模式由模型本身或显式模型名控制,
 * 此处不做强制处理。
 */
function applyThinkingDisable<T extends Record<string, unknown>>(
  provider: ReturnType<typeof getCurrentProvider>,
  params: T
): void {
  const meta = getLlmProvider(provider);
  if (meta?.supportsThinkingDisable) {
    (params as unknown as { thinking?: { type: 'enabled' | 'disabled' } }).thinking =
      { type: 'disabled' };
  }
}

/**
 * 重置 LLM 客户端单例
 * 在 API Key 通过前端/热更新接口更新后调用,使新 key 立即生效
 * provider 切换后也会自动重建,这里保留显式重置用于强制刷新
 */
export function resetLlmClient(): void {
  _client = null;
  _clientProvider = null;
}

/** 简化消息类型(支持工具调用的 tool 角色) */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** tool 角色消息: 关联的工具调用 id */
  tool_call_id?: string;
  /** assistant 角色消息: 请求的工具调用列表(OpenAI 格式) */
  tool_calls?: unknown;
}

export interface ChatOptions {
  /** 期望 JSON 模式响应 */
  jsonMode?: boolean;
  /** 温度 0-1,越低越稳定 */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
  /** 超时(秒),默认 60 */
  timeoutSec?: number;
  /**
   * v1.5 缓存元信息: 传入后会先查 SQLite 缓存表;命中直接返回;未命中则在调用成功后写盘
   * 不传则完全不走缓存路径(避免误缓存讨论流等场景)
   */
  cacheMeta?: CacheMeta;
}

/**
 * 单轮对话调用
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const client = getClient();
  const model = getCurrentModel();
  const provider = getCurrentProvider();

  const params: Parameters<typeof client.chat.completions.create>[0] = {
    model,
    messages: messages as unknown as Parameters<
      typeof client.chat.completions.create
    >[0]['messages'],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };

  if (options.jsonMode) {
    params.response_format = { type: 'json_object' };
  }

  // 调用 Provider 元数据驱动的 thinking 禁用策略(目前仅 DeepSeek)
  applyThinkingDisable(provider, params as unknown as Record<string, unknown>);

  try {
    const res = await client.chat.completions.create(params);
    // 显式收窄联合类型 - 上面 stream:false 已保证非 Stream
    const completion = res as OpenAI.ChatCompletion;
    const choice = completion.choices[0];
    const content = choice?.message?.content ?? '';
    if (!content) throw new Error('LLM 返回内容为空');
    return content;
  } catch (err) {
    logger.error({ err, provider, model }, 'LLM 调用失败');
    throw new Error(
      `LLM 调用失败:${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * JSON 模式对话 - 自动解析返回的 JSON
 * 失败时抛出错误,不返回 null
 *
 * v1.5 缓存: 传入 options.cacheMeta 时先查 SQLite;命中直接返回;未命中调用成功落盘
 */
export async function chatJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options: Omit<ChatOptions, 'jsonMode'> = {}
): Promise<T> {
  // v1.5 cache lookup
  if (options.cacheMeta) {
    const cacheKey = makeCacheKey(
      options.cacheMeta.schemaName,
      systemPrompt,
      userPrompt,
      options
    );
    const cached = getCachedOutput(cacheKey);
    if (cached !== null) {
      recordCacheResult(options.cacheMeta.schemaName, 'hit');
      return parseJsonContent(cached) as T;
    }
    recordCacheResult(options.cacheMeta.schemaName, 'miss');
  }

  const content = await chatComplete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { ...options, jsonMode: true }
  );

  // v1.5 cache write-back
  if (options.cacheMeta) {
    const cacheKey = makeCacheKey(
      options.cacheMeta.schemaName,
      systemPrompt,
      userPrompt,
      options
    );
    setCachedOutput(cacheKey, options.cacheMeta.schemaName, content, {
      inputSize: systemPrompt.length + userPrompt.length,
    });
  }

  return parseJsonContent(content) as T;
}

function parseJsonContent(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    logger.error({ content: cleaned.slice(0, 500) }, 'JSON parse failed');
    throw new Error(
      `LLM returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function recordCacheResult(schemaName: string, kind: 'hit' | 'miss'): void {
  recordCacheResultMetric(schemaName, kind);
  logger.debug({ schemaName, kind }, 'LLM cache result');
}

/**
 * 带 schema 校验失败自动重试的 JSON 对话
 *
 * 为什么需要:
 *   LLM 在生成结构化 JSON 时,即便 prompt 已给出 schema 示例,仍可能因为:
 *     1. 字段名拼写不一致(name vs plan_name、container vs containerization 等)
 *     2. 必填字段缺失
 *     3. 长度/枚举校验不通过(reason 太短、风险等级写错等)
 *   一次性失败会让用户在前端看到"任务失败"的错误,体感很差。
 *   本方法在校验失败时,把 zod 的具体 issues 作为反馈注入到 user prompt,
 *   重新调用 LLM 让它修正,最多 retry 次(默认 2 次,即总共 3 次尝试)。
 *
 * 新增能力(v1.2):
 *   - options.schemaName: 传入后会自动 (a) 追加到注入的 JSON Schema 标题,
 *     (b) 作为重试率指标聚合的 key。强烈建议各调用方传入可读名称
 *   - options.injectSchema (默认 true): 自动把 zod schema 转成的 JSON Schema
 *     拼到 system prompt 末尾,避免手写示例与运行时校验漂移
 *   - options.maxRetries (默认 2): 最大重试次数。与 chatCompleteWithSchemaRetry 保持一致,
 *     都是 options 字段,避免调用方混淆两种签名。
 *
 * 适用场景:
 *   任何「chatJson + Zod schema.safeParse」的简单结构化输出流。
 *   复杂的多轮/工具调用流程(如 DiscussionService.runChat)不适用,
 *   应使用 chatCompleteWithSchemaRetry。
 */
export async function chatJsonWithSchemaRetry<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: ZodTypeAny,
  options: Omit<ChatOptions, 'jsonMode'> & {
    /** schema 标识,同时用于 prompt 中的标题与指标聚合 key */
    schemaName?: string;
    /** 是否自动把 JSON Schema 拼到 system prompt 末尾,默认 true */
    injectSchema?: boolean;
    /** 最大重试次数,默认 2(总共 3 次尝试) */
    maxRetries?: number;
  } = {}
): Promise<T> {
  const schemaName =
    options.schemaName?.trim() ||
    (typeof schema.description === 'string' ? schema.description : '') ||
    'unknown';
  const injectSchema = options.injectSchema !== false;
  const maxRetries = options.maxRetries ?? 2;

  // 在 system prompt 末尾追加 JSON Schema 段(与手写示例互补)
  const enrichedSystem = injectSchema
    ? `${systemPrompt}\n\n${buildSchemaPromptSection(schema, { schemaName })}`
    : systemPrompt;

  let lastError: ZodError | null = null;
  let currentUserPrompt = userPrompt;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    const raw = await chatJson<unknown>(enrichedSystem, currentUserPrompt, options);
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      if (attempt > 0) {
        logger.info(
          { attempt: attempt + 1, schemaName },
          'LLM 输出经重试后通过 schema 校验'
        );
      }
      recordRetryResult({ schemaName, attempts, succeeded: true });
      return parsed.data as T;
    }

    lastError = parsed.error;
    logger.warn(
      {
        attempt: attempt + 1,
        schemaName,
        issueCount: parsed.error.issues.length,
        sampleIssues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      'LLM 输出未通过 schema 校验'
    );

    if (attempt >= maxRetries) break;

    // 把 zod 错误作为反馈注入到 user prompt,引导模型修正(共享 formatRetryFeedback)
    currentUserPrompt = `${userPrompt}\n\n${formatRetryFeedback(parsed.error, schemaName)}`;
  }

  recordRetryResult({ schemaName, attempts, succeeded: false });
  const finalDetail = lastError!.issues
    .slice(0, 20)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
  throw new Error(
    `LLM 输出未通过 schema 校验(已重试 ${maxRetries} 次):${finalDetail}`
  );
}

/**
 * 带 schema 校验失败自动重试的多轮对话 JSON 收尾
 *
 * 实现已拆分到 [./chatCompleteRetry.ts](./chatCompleteRetry.ts),此处 re-export 保持向后兼容。
 * 拆分原因:`chatCompleteWithSchemaRetry` 与 `chatComplete` 同文件时,函数体内调用
 * `chatComplete(...)` 是模块内调用,vi.mock 无法替换。拆到独立文件后,通过 import
 * 绑定进入,测试可以正常 mock LLMClient 的 chatComplete。
 */
export { chatCompleteWithSchemaRetry } from './chatCompleteRetry.js';

// ---------- 工具调用(function calling) ----------

/** 一个工具的 JSON Schema 描述(OpenAI 兼容) */
export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** LLM 请求的工具调用 */
export interface ChatToolCall {
  id: string;
  name: string;
  /** 工具参数,JSON 字符串 */
  arguments: string;
}

/** 支持工具调用的单轮对话结果 */
export interface ChatWithToolsResult {
  content: string;
  toolCalls: ChatToolCall[];
}

/**
 * 带工具调用的对话
 * 返回 content + toolCalls(可两者兼有)。调用方需自行把 tool 结果回填后二次调用。
 * 注意:工具调用与 response_format=json_object 在部分模型上不兼容,
 *      因此此函数不使用 jsonMode,返回的 content 由调用方自行解析。
 */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: ChatTool[],
  options: ChatOptions = {}
): Promise<ChatWithToolsResult> {
  const client = getClient();
  const model = getCurrentModel();
  const provider = getCurrentProvider();

  const params: Parameters<typeof client.chat.completions.create>[0] = {
    model,
    messages: messages as unknown as Parameters<
      typeof client.chat.completions.create
    >[0]['messages'],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
    tools: tools as Parameters<typeof client.chat.completions.create>[0]['tools'],
  };

  // Provider 元数据驱动的 thinking 禁用策略
  applyThinkingDisable(provider, params as unknown as Record<string, unknown>);

  try {
    const res = await client.chat.completions.create(params);
    const completion = res as OpenAI.ChatCompletion;
    const choice = completion.choices[0];
    const message = choice?.message;
    const content = message?.content ?? '';
    const rawCalls = message?.tool_calls;

    const toolCalls: ChatToolCall[] = (rawCalls ?? [])
      .filter((c) => c.type === 'function')
      .map((c) => ({
        id: c.id,
        name: c.function?.name ?? '',
        arguments: c.function?.arguments ?? '{}',
      }))
      .filter((c) => c.name);

    return { content, toolCalls };
  } catch (err) {
    logger.error({ err, provider, model }, 'LLM 工具调用失败');
    throw new Error(
      `LLM 工具调用失败:${err instanceof Error ? err.message : String(err)}`
    );
  }
}