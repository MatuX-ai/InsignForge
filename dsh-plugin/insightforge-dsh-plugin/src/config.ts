/**
 * InsightForge 插件配置 Schema —— 文档 3.2 节
 *
 * 使用 @deepseek-ai/schemastery 的 DSL,框架在加载插件时自动校验
 * 用户在 cordis.yml 中填写的 Config 段,失败则明确报错(NFR-03)。
 *
 * 7 项配置(严格对应需求文档):
 * - llmProvider   string  deepseek/openai/ollama  默认 deepseek
 * - llmApiKey     string  必填(若 provider != ollama)
 * - searchProvider string  openserp/serpapi        默认 openserp
 * - searchEndpoint string                       默认 http://localhost:8080
 * - dbPath        string                       默认 ./data/insightforge.db
 * - cacheEnabled  boolean  默认 true
 * - maxConcurrent number   1-32                  默认 5
 *
 * 类型 `Config` 见 ./config-types.ts
 */
import Schema from '@deepseek-ai/schemastery';

// 显式标注为 any 以避免 schemastery 内部类型暴露问题
// 运行时该值就是 schemastery 的 ObjectSchema<Config>
// 任何调用方只需把它当作"输入未知 -> 输出 Config"的 validator 即可
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Config: any = Schema.object({
  llmProvider: Schema.union(
    Schema.literal('deepseek'),
    Schema.literal('openai'),
    Schema.literal('ollama')
  )
    .default('deepseek')
    .description('大模型提供商:deepseek/openai/ollama'),

  llmApiKey: Schema.string()
    .required()
    .description('大模型 API Key;ollama 可填占位符'),

  searchProvider: Schema.union(
    Schema.literal('openserp'),
    Schema.literal('serpapi')
  )
    .default('openserp')
    .description('搜索引擎提供商:openserp/serpapi'),

  searchEndpoint: Schema.string()
    .default('http://localhost:8080')
    .description('OpenSerp 服务地址(或 SerpAPI 端点)'),

  dbPath: Schema.string()
    .default('./data/insightforge.db')
    .description('本地需求库路径;可与个人版共享同一份 SQLite'),

  cacheEnabled: Schema.boolean()
    .default(true)
    .description('是否启用市场报告结果缓存(LRU,基于 idea+depth+day)'),

  maxConcurrent: Schema.number()
    .min(1)
    .max(32)
    .default(5)
    .description('最大并发调研任务数(1-32)'),
});