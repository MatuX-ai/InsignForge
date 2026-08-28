/**
 * schema 重试通用工具函数
 *
 * 用途:
 *   chatJsonWithSchemaRetry 与 chatCompleteWithSchemaRetry 共享反馈格式化逻辑,
 *   统一中文风格 + 截断 + 路径展示,避免两处副本漂移。
 *
 * 设计:
 *   - formatRetryFeedback 输出纯文本反馈段,拼到 user prompt 末尾
 *   - makeJsonParseError 把 JSON.parse 失败包装成 ZodError,
 *     复用统一的反馈展示路径(避免 chatCompleteRetry / chatJson 各自处理 raw parse error)
 *   - 不依赖 LLMClient 或 chatComplete,纯函数式,便于单测
 */
import { ZodError } from 'zod';

/**
 * 把 zod issues 拼成"上一轮校验反馈"段,中文风格
 *
 * @param error       zod 校验失败的错误
 * @param schemaName  当前 schema 的可读名,用于反馈段开头提示"上一轮(XXX)输出未通过"
 * @returns           可直接拼到 user prompt 末尾的 markdown 段落
 */
export function formatRetryFeedback(error: ZodError, schemaName: string): string {
  const detail = error.issues
    .slice(0, 20)
    .map((i) => `- ${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('\n');
  return [
    '---',
    '',
    '## 上一轮校验反馈(重要)',
    `你上一轮(${schemaName})的输出未通过结构化校验,具体问题如下:`,
    detail,
    '',
    '请按上述反馈修正后重新输出。要求:',
    '- 严格使用 system prompt 中指定的字段名,不要改字段名、不要新增未要求的字段',
    '- 必填字段一个都不能少',
    '- 长度/枚举约束(例如 reason 至少 10 字、风险等级必须是 low/medium/high)必须满足',
    '- 保持原 JSON 整体结构,只修正出错的字段',
  ].join('\n');
}

/**
 * 把 JSON 解析失败"伪装"成 ZodError,复用统一反馈段
 *
 * issues 用单一 "root" 路径,消息里包含原始片段便于排查。
 * 这样 chatJsonWithSchemaRetry / chatCompleteWithSchemaRetry 不需要单独
 * 维护"JSON 解析失败"分支的反馈格式。
 *
 * @param raw  LLM 返回的原始字符串(已去除 ```json 包裹)
 * @param err  JSON.parse 抛出的错误
 */
export function makeJsonParseError(raw: string, err: unknown): ZodError {
  const message = err instanceof Error ? err.message : String(err);
  return new ZodError([
    {
      code: 'custom',
      path: [],
      message: `JSON 解析失败:${message};片段:${raw.slice(0, 100)}`,
    },
  ]);
}
