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
import { config, getLlmApiKey, getLlmBaseUrl } from '../../config.js';
import { logger } from '../../logger.js';

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

/**
 * 获取 OpenAI 兼容客户端(单例)
 */
function getClient(): OpenAI {
  if (_client) return _client;

  const apiKey = getLlmApiKey();
  if (!apiKey && config.LLM_PROVIDER !== 'ollama') {
    logger.warn(
      { provider: config.LLM_PROVIDER },
      `${config.LLM_PROVIDER} 未配置 API Key,LLM 调用将失败`
    );
    // 立即抛出,避免后续使用占位 key 浪费时间并污染日志
    throw new MissingLlmApiKeyError(config.LLM_PROVIDER);
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
 */
export function resetLlmClient(): void {
  _client = null;
}

/** 简化消息类型 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

  const params: Parameters<typeof client.chat.completions.create>[0] = {
    model: config.LLM_MODEL,
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };

  if (options.jsonMode) {
    params.response_format = { type: 'json_object' };
  }

  // DeepSeek V4 默认开启思考模式,返回内容会写入 reasoning_content 而 content 为空
  // InsightForge 是结构化 JSON 输出场景,不需要思考阶段,通过 extra_body 禁用思考
  // 其他 provider(OpenAI / Ollama)忽略该字段不会出错
  if (config.LLM_PROVIDER === 'deepseek') {
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
    logger.error({ err, provider: config.LLM_PROVIDER, model: config.LLM_MODEL }, 'LLM 调用失败');
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