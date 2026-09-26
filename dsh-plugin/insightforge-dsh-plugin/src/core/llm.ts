/**
 * LLM 客户端 - OpenAI 兼容协议(改编自 backend/src/services/llm/LLMClient.ts)
 *
 * 适配点:
 * 1. 配置不再从 process.env 读取,改为从 Config 对象
 * 2. 默认 baseUrl / model 由 Config 推导
 * 3. 增加 chatJsonSafe —— 容错解析 LLM 返回(自动剥除 ```json 包裹)
 *
 * 与 backend 的语义保持一致,使插件与个人版产出结构相同的报告。
 */
import OpenAI from 'openai';
import type { Config } from '../config-types.js';
import { logger } from '../logger.js';

let _client: OpenAI | null = null;
let _clientConfig: Config | null = null;

function resolveBaseUrl(cfg: Config): string {
  // 与 backend/src/services/llm/providers.ts / packages/core/src/llm.ts 保持一致
  // 所有 OpenAI 兼容端点都以 /v1 结尾(zhipu 例外走 /api/paas/v4)
  if (cfg.llmProvider === 'ollama') {
    return process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }
  if (cfg.llmProvider === 'deepseek') {
    return process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  }
  if (cfg.llmProvider === 'openai') {
    return process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }
  // 国产大模型(OpenAI 兼容协议)的默认 baseUrl
  if (cfg.llmProvider === 'zhipu') {
    return process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
  }
  if (cfg.llmProvider === 'qwen') {
    return process.env.QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }
  if (cfg.llmProvider === 'moonshot') {
    return process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn/v1';
  }
  if (cfg.llmProvider === 'yi') {
    return process.env.YI_BASE_URL ?? 'https://api.lingyiwanwu.com/v1';
  }
  if (cfg.llmProvider === 'MiniMax') {
    return process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/v1';
  }
  if (cfg.llmProvider === 'hunyuan') {
    return process.env.HUNYUAN_BASE_URL ?? 'https://api.hunyuan.tencent.com/v1';
  }
  if (cfg.llmProvider === 'sensenova') {
    return process.env.SENSENOVA_BASE_URL ?? 'https://token.sensenova.cn/v1';
  }
  if (cfg.llmProvider === 'stepfun') {
    return process.env.STEPFUN_BASE_URL ?? 'https://api.stepfun.com/v1';
  }
  return 'https://api.openai.com/v1';
}

function resolveModel(cfg: Config): string {
  // 与 backend/providers.ts 默认模型保持一致:
  // - deepseek: 默认 deepseek-flash(2026-09 用户反馈后的 .env 默认),
  //   'deepseek-chat' 已于 2026-07-24 停用
  return (
    process.env.LLM_MODEL ??
    (cfg.llmProvider === 'deepseek' ? 'deepseek-flash' : 'gpt-4o-mini')
  );
}

/**
 * 获取 OpenAI 兼容客户端(单例 + config 变更检测)
 */
function getClient(cfg: Config): OpenAI {
  if (_client && _clientConfig === cfg) return _client;

  const apiKey = cfg.llmApiKey || 'sk-placeholder';
  if (!cfg.llmApiKey && cfg.llmProvider !== 'ollama') {
    logger.warn(
      { provider: cfg.llmProvider },
      `${cfg.llmProvider} 未配置 API Key,LLM 调用将失败`
    );
  }

  _client = new OpenAI({
    apiKey,
    baseURL: resolveBaseUrl(cfg),
    timeout: 60_000,
  });
  _clientConfig = cfg;
  return _client;
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
  cfg: Config,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const client = getClient(cfg);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: resolveModel(cfg),
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };

  if (options.jsonMode) {
    params.response_format = { type: 'json_object' };
  }

  try {
    const res = await client.chat.completions.create(params);
    const completion = res as OpenAI.ChatCompletion;
    const choice = completion.choices[0];
    const content = choice?.message?.content ?? '';
    if (!content) throw new Error('LLM 返回内容为空');
    return content;
  } catch (err) {
    logger.error(
      { err, provider: cfg.llmProvider, model: resolveModel(cfg) },
      'LLM 调用失败'
    );
    throw new Error(
      `LLM 调用失败:${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * JSON 模式对话 —— 自动解析返回的 JSON,失败抛出
 */
export async function chatJson<T>(
  cfg: Config,
  systemPrompt: string,
  userPrompt: string,
  options: Omit<ChatOptions, 'jsonMode'> = {}
): Promise<T> {
  const content = await chatComplete(
    cfg,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { ...options, jsonMode: true }
  );

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

/** 测试 / 重连场景下重置客户端单例 */
export function resetLlmClient(): void {
  _client = null;
  _clientConfig = null;
}