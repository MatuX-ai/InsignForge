/**
 * 共享：工具错误归类
 *
 * 将 SDK 抛出的各类异常映射到 McpToolError(带错误码前缀),
 * 便于 MCP 客户端按错误码做差异化处理(MCP-41)。
 *
 * 注意：绝不在错误信息中泄露 llmApiKey / Authorization 头等敏感字段(MCP-42)。
 */
import { McpToolError, type ToolErrorKind } from '../config-loader.js';

/** 敏感字段匹配模式(用于从错误消息中脱敏) */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer 必须先于 sk- 匹配,避免 sk- 被单独的 REDACTED_API_KEY 覆盖掉 Bearer 标记
  { pattern: /Bearer\s+[A-Za-z0-9_\-]{16,}/gi, replacement: 'Bearer [REDACTED]' },
  // OpenAI / DeepSeek / Anthropic API key(sk-xxx)
  { pattern: /\bsk-[A-Za-z0-9_\-]{16,}\b/g, replacement: '[REDACTED_API_KEY]' },
  // URL 中嵌入的 api_key / token 参数
  { pattern: /([?&])(api_key|access_token|token|key)=([^&\s]+)/gi, replacement: '$1$2=[REDACTED]' },
];

/**
 * 对任意字符串做敏感字段脱敏
 */
export function sanitize(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 根据异常内容推断错误码。
 *
 * 启发式规则(简单但有效)：
 * - 含 'rate limit' / '429' → E_LLM_RATE_LIMIT 或 E_SEARCH_RATE_LIMIT
 * - 含 'timeout' / 'ETIMEDOUT' / 'aborted' → E_LLM_TIMEOUT
 * - 含 'authentication' / 'unauthorized' / '401' / '403' → E_LLM_AUTH
 * - 含 'JSON' / 'parse' / 'invalid output' → E_LLM_INVALID_OUTPUT
 * - 含 'ENOTFOUND' / 'ECONNREFUSED' / 'fetch failed' → E_SEARCH_NETWORK
 * - 含 'SQLITE' / 'database' / 'no such table' → E_DB_*
 * - 其他 → E_INTERNAL 或 E_LLM_UNKNOWN
 */
export function classifyError(err: unknown): McpToolError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const safeMessage = sanitize(message);

  if (/(rate\s*limit|too\s*many\s*requests|429)/i.test(lower)) {
    if (/search|serp|hackernews|reddit|openserp/i.test(lower)) {
      return new McpToolError('E_SEARCH_RATE_LIMIT', safeMessage, { cause: err });
    }
    return new McpToolError('E_LLM_RATE_LIMIT', safeMessage, { cause: err });
  }

  if (/(timeout|etimedout|aborted|deadline)/i.test(lower)) {
    return new McpToolError('E_LLM_TIMEOUT', safeMessage, { cause: err });
  }

  if (/(unauthorized|forbidden|invalid\s*api\s*key|401|403|authentication)/i.test(lower)) {
    return new McpToolError('E_LLM_AUTH', safeMessage, { cause: err });
  }

  if (/(json|parse|invalid.*output|schema.*validation|unexpected.*token)/i.test(lower)) {
    return new McpToolError('E_LLM_INVALID_OUTPUT', safeMessage, { cause: err });
  }

  if (/(enotfound|econnrefused|econnreset|fetch failed|network)/i.test(lower)) {
    return new McpToolError('E_SEARCH_NETWORK', safeMessage, { cause: err });
  }

  if (/(sqlite|database|no such table|disk[\s_-]?i[\s_-]?o|migrations?)/i.test(lower)) {
    if (/(write|insert|update)/i.test(lower)) {
      return new McpToolError('E_DB_WRITE', safeMessage, { cause: err });
    }
    if (/(read|select|query)/i.test(lower)) {
      return new McpToolError('E_DB_READ', safeMessage, { cause: err });
    }
    return new McpToolError('E_DB_NOT_READY', safeMessage, { cause: err });
  }

  if (/(config|validation|invalid argument|required|missing)/i.test(lower)) {
    return new McpToolError('E_VALIDATION', safeMessage, { cause: err });
  }

  return new McpToolError('E_INTERNAL', safeMessage, { cause: err });
}

/**
 * 将 McpToolError 序列化为 MCP 错误响应内容。
 *
 * 序列化策略：
 * - type='text' 提供人类可读 message
 * - 第二个 content 块携带 JSON 错误码/上下文,便于程序化处理
 */
export function errorToMcpContent(err: McpToolError): Array<
  | { type: 'text'; text: string }
  | { type: 'text'; text: string; _meta?: Record<string, unknown> }
> {
  return [
    {
      type: 'text' as const,
      text: `[${err.kind}] ${err.message}`,
    },
    {
      type: 'text' as const,
      text: JSON.stringify(
        { code: err.kind, message: err.message, context: err.context ?? {} },
        null,
        2,
      ),
      _meta: { errorCode: err.kind },
    },
  ];
}

/** 暴露工具错误码常量集合(便于外部消费者 / 测试断言) */
export const ERROR_KINDS: ReadonlyArray<ToolErrorKind> = [
  'E_LLM_RATE_LIMIT',
  'E_LLM_TIMEOUT',
  'E_LLM_INVALID_OUTPUT',
  'E_LLM_AUTH',
  'E_LLM_UNKNOWN',
  'E_SEARCH_NETWORK',
  'E_SEARCH_EMPTY',
  'E_SEARCH_RATE_LIMIT',
  'E_DB_NOT_READY',
  'E_DB_WRITE',
  'E_DB_READ',
  'E_CONFIG',
  'E_VALIDATION',
  'E_INTERNAL',
];