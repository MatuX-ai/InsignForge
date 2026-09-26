/**
 * InsightForge 插件配置 - 纯类型定义
 *
 * 与 src/config.ts 配合使用;分离的目的是避免 `export const Config`
 * 与 `export type Config` 名称冲突,同时为工具/服务层提供类型导入入口。
 */
/**
 * LlmProvider 枚举与后端 backend/src/services/llm/providers.ts 保持一致
 * 国产模型为 2026-09 增补,与 packages/core/src/llm.ts 的 baseUrl 默认值同步
 */
export type LlmProvider =
  | 'deepseek'
  | 'openai'
  | 'ollama'
  // 国产大模型(OpenAI 兼容协议)
  | 'zhipu'
  | 'qwen'
  | 'moonshot'
  | 'yi'
  | 'MiniMax'
  | 'hunyuan'
  | 'sensenova'
  | 'stepfun';
export type SearchProvider = 'openserp' | 'serpapi';

export interface Config {
  llmProvider: LlmProvider;
  llmApiKey: string;
  searchProvider: SearchProvider;
  searchEndpoint: string;
  dbPath: string;
  cacheEnabled: boolean;
  maxConcurrent: number;
}

/** 在框架调用 apply 之前的 Config 形态(全字段必填) */
export type ResolvedConfig = {
  [K in keyof Config]: Config[K];
};

/** 深度档位 → LLM/搜索参数映射表(供 researcher 使用) */
export interface DepthProfile {
  /** 提取关键词个数 */
  keywordCount: number;
  /** 报告生成 max_tokens */
  maxTokens: number;
  /** 关键词提取 max_tokens */
  keywordTokens: number;
  /** 抓取条目上限 */
  searchLimit: number;
  /** temperature */
  temperature: number;
  /** 估算耗时秒(供 UI 展示) */
  estimatedSeconds: number;
}