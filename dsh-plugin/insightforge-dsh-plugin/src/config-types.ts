/**
 * InsightForge 插件配置 - 纯类型定义
 *
 * 与 src/config.ts 配合使用;分离的目的是避免 `export const Config`
 * 与 `export type Config` 名称冲突,同时为工具/服务层提供类型导入入口。
 */
export type LlmProvider = 'deepseek' | 'openai' | 'ollama';
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