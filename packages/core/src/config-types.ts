/**
 * InsightForge SDK 配置 - 纯类型定义
 *
 * SDK 是框架无关的纯算法库,Config 由调用方显式注入;
 * 运行时校验见 ./config.ts 中的 validateConfig()。
 *
 * LlmProvider 与后端 backend/src/services/llm/providers.ts 中的注册表保持同步
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

/** SDK 完整运行时配置(全字段已解析默认值) */
export interface Config {
  llmProvider: LlmProvider;
  llmApiKey: string;
  /** LLM 自定义 baseURL;留空则按 provider 推导 */
  llmBaseUrl?: string;
  /** LLM 模型名;留空则按 provider 推导 */
  llmModel?: string;
  searchProvider: SearchProvider;
  searchEndpoint: string;
  dbPath: string;
  cacheEnabled: boolean;
  maxConcurrent: number;
  /** 日志级别(SDK-49) */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/** 在 validateConfig() 之前的 Config 形态(全字段必填) */
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
