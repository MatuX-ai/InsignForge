/**
 * InsightForge SDK 配置校验(Zod 实现,替代原 dsh-plugin 的 schemastery)
 *
 * 设计要点:
 * 1. validateConfig() 接收 Partial<Config>(用户输入),返回 ResolvedConfig(全字段已补默认值)
 * 2. 缺失必填字段时抛出明确错误,包含字段名(便于排查)
 * 3. SDK 不依赖任何 dsh 生态包;Zod 已是 zod v3.x 标准依赖
 * 4. 与原 dsh-plugin/src/config.ts 行为保持完全一致(默认值、enum、范围)
 *
 * 文档:05-集成扩展需求文档.md §3.1.4
 */
import { z } from 'zod';
import type { Config, ResolvedConfig } from './config-types.js';

/**
 * 严格 Config schema —— 用于 validateConfig() 输入校验
 */
const ConfigSchema = z
  .object({
    llmProvider: z.enum(['deepseek', 'openai', 'ollama']).default('deepseek'),
    llmApiKey: z.string().min(1, 'llmApiKey 必填'),
    llmBaseUrl: z.string().url().optional(),
    llmModel: z.string().min(1).optional(),
    searchProvider: z.enum(['openserp', 'serpapi']).default('openserp'),
    searchEndpoint: z.string().min(1).default('http://localhost:18080'),
    dbPath: z.string().min(1).default('./data/insightforge.db'),
    cacheEnabled: z.boolean().default(true),
    maxConcurrent: z.number().int().min(1).max(32).default(5),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .strict();

/**
 * 校验并解析用户输入为完整 Config
 *
 * @throws ZodError 当字段缺失或越界时
 *
 * @example
 * ```ts
 * const config = validateConfig({
 *   llmApiKey: process.env.LLM_API_KEY!,
 * });
 * // config.cacheEnabled === true
 * // config.searchEndpoint === 'http://localhost:18080'
 * ```
 */
export function validateConfig(input: Partial<Config>): ResolvedConfig {
  const parsed = ConfigSchema.parse(input);
  return parsed as ResolvedConfig;
}

/**
 * 宽松版校验:不抛错,返回 { ok, config?, error? }
 * 适用于 MCP/CLI 等需要友好错误信息的场景
 */
export function tryValidateConfig(
  input: Partial<Config>
):
  | { ok: true; config: ResolvedConfig }
  | { ok: false; error: string } {
  const result = ConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data as ResolvedConfig };
  }
  const issues = result.error.issues
    .map(
      (iss: { path: Array<string | number>; message: string }) =>
        `${iss.path.join('.') || '(root)'}: ${iss.message}`
    )
    .join('; ');
  return { ok: false, error: issues };
}

/**
 * Config Zod schema(导出供高级用户直接访问)
 */
export { ConfigSchema };
