/**
 * 把 zod schema 转成 JSON Schema 并组装成可直接拼到 system prompt 的 markdown 片段
 *
 * 设计动机:
 *   LLM 在生成结构化 JSON 时,即便 prompt 里写明了"输出示例",仍可能:
 *     - 拼错字段名(name vs plan_name、container vs containerization 等)
 *     - 漏掉必填字段
 *     - 忽略长度/枚举约束(reason 太短、风险等级写错等)
 *   手写示例受限于维护成本,经常与实际 schema 漂移;用 zod 直接生成 JSON Schema:
 *     1. 字段名/类型/必填项/约束 与运行时校验严格一致
 *     2. 改 zod schema 时不需要再同步手写示例,避免漂移
 *     3. 仍保留 Prompt 中的手写示例段落(用于语义引导),两者互补
 *
 * 兼容性:
 *   - target: 'jsonSchema7' 对 DeepSeek / OpenAI / Qwen / GLM / Kimi / Yi 等
 *     OpenAI 兼容厂商普遍友好,oneOf + const discriminator 也能正确解析
 *   - $refStrategy: 'none' 让嵌套类型全部内联,prompt 一次到位,
 *     避免模型在 #/$ref/... 之间迷失(实测大 schema 加 rootRef 后模型经常"找不到"引用)
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

export interface BuildSchemaPromptOptions {
  /** 仅用于文档可读性,不会写进 schema 本身 */
  schemaName?: string;
}

/**
 * 把 zod schema 转成可注入到 system prompt 的 markdown 片段
 * 输出形如:
 *   ## 输出 JSON Schema(必须严格遵守)
 *   所有字段名、类型、必填项、长度/枚举约束必须严格满足。如果与上文描述冲突,以本 Schema 为准。
 *
 *   ```json
 *   { ... }
 *   ```
 */
export function buildSchemaPromptSection(
  schema: ZodTypeAny,
  options: BuildSchemaPromptOptions = {}
): string {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  });

  const name = options.schemaName?.trim();
  const heading = name
    ? `## 输出 JSON Schema(${name},必须严格遵守)`
    : '## 输出 JSON Schema(必须严格遵守)';

  return [
    heading,
    '',
    '所有字段名、类型、必填项、长度/枚举约束必须严格满足。如果与上文描述冲突,以本 Schema 为准。',
    '',
    '```json',
    JSON.stringify(jsonSchema, null, 2),
    '```',
  ].join('\n');
}
