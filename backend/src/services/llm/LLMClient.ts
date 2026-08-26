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
import { getLlmBaseUrl } from '../../config.js';
import { logger } from '../../logger.js';
import {
  getCurrentProvider,
  getCurrentModel,
  resolveLlmApiKey,
} from '../SettingsService.js';

/**
 * 缺少 LLM API Key 时抛出的专用错误
 * 用于上层统一识别并提示用户去设置页面配置
 */
export class MissingLlmApiKeyError extends Error {
  readonly code = 'MISSING_API_KEY';
  readonly provider: string;

  constructor(provider: string) {
    super(
      `未配置 ${provider} 的 API Key,请前往「设置」页面填写,或在后端 .env 中配置 ${provider.toUpperCase()}_API_KEY 后重启服务`
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

  const apiKey = resolveLlmApiKey();
  if (!apiKey && provider !== 'ollama') {
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

  // DeepSeek 默认开启思考模式,返回内容会写入 reasoning_content 而 content 为空
  // InsightForge 是结构化 JSON 输出场景,不需要思考阶段,通过 extra_body 禁用思考
  // 其他 provider(OpenAI / Ollama)忽略该字段不会出错
  if (provider === 'deepseek') {
    (params as unknown as { thinking?: { type: 'enabled' | 'disabled' } }).thinking =
      { type: 'disabled' };
  }

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
 */
export async function chatJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options: Omit<ChatOptions, 'jsonMode'> = {}
): Promise<T> {
  const content = await chatComplete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { ...options, jsonMode: true }
  );

  // 容错:有些模型返回时包裹 ```json ... ```
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    logger.error({ content: cleaned.slice(0, 500) }, 'JSON 解析失败');
    throw new Error(
      `LLM 返回的 JSON 格式无效:${err instanceof Error ? err.message : String(err)}`
    );
  }
}

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

  // DeepSeek 默认开启思考模式,结构化工具编排场景不需要,禁用思考
  if (provider === 'deepseek') {
    (params as unknown as { thinking?: { type: 'enabled' | 'disabled' } }).thinking = {
      type: 'disabled',
    };
  }

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