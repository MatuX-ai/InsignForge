/**
 * InsightForge Core SDK —— 公共 API 入口
 *
 * 该文件是 @insightforge/core 的唯一对外入口;
 * 使用者应只从此文件导入,不应直接引用内部子模块。
 *
 * 分层:
 * 1. 主类与工厂函数(SDK-30 / SDK-31)
 * 2. 配置与类型(Config / DepthProfile)
 * 3. Zod 运行时校验 schemas(SDK-33 / SDK-34)
 * 4. LLM Prompt 模板与构造器(SDK-35 ~ SDK-38)
 * 5. 数据/工具层(LRU 缓存、并发控制、DB、Landing 生成、数据源客户端)
 * 6. 共享类型(types.ts,SDK-39)
 * 7. 日志(logger)
 *
 * 文档:05-集成扩展需求文档.md §3.1.3
 */

// ============================================================
// 1) 主类与工厂函数(SDK-30 / SDK-31 / SDK-32)
// ============================================================
export {
  InsightForgeCore,
  createInsightForgeCore,
  getDepthProfile,
  type ResearchRequest,
  type ResearchResult,
  type HealthCheckResult,
} from './researcher.js';

// ============================================================
// 2) 配置与类型 —— Config / ResolvedConfig / DepthProfile
// ============================================================
export type {
  Config,
  ResolvedConfig,
  DepthProfile,
  LlmProvider,
  SearchProvider,
} from './config-types.js';
export { validateConfig, tryValidateConfig, ConfigSchema } from './config.js';

// ============================================================
// 3) Zod 运行时校验 schemas(SDK-33 / SDK-34)
// ============================================================
export {
  MarketReportSchema,
  KeywordExtractionSchema,
  ReportSourceSchema,
  CompetitorSchema,
  MarketHeatSchema,
  type ValidatedMarketReport,
  type ValidatedKeywords,
  type ValidatedCompetitor,
} from './schemas/report.js';

// ============================================================
// 4) LLM Prompt 模板与构造器(SDK-35 ~ SDK-38)
// ============================================================
export {
  KEYWORD_EXTRACTION_SYSTEM,
  buildKeywordExtractionUserPrompt,
  REPORT_GENERATION_SYSTEM,
  buildReportUserPrompt,
} from './prompts/index.js';

// ============================================================
// 5) 数据/工具层
// ============================================================

// 5.1 LRU 缓存
export { SimpleLRUCache, reportCacheKey, type ReportCache } from './cache.js';

// 5.2 并发控制(Semaphore,NFR-06)
export { Semaphore } from './concurrency.js';

// 5.3 SQLite 数据库(NFR-04)
export { getDb, closeDb, hasSqliteBindings, inspectDatabase } from './db.js';

// 5.4 Landing Page 生成(generate_landing 工具)
export { generateLanding, type LandingInput } from './landing.js';

// 5.5 LLM 客户端底层(chatJson / chatComplete / resetLlmClient)
export {
  chatComplete,
  chatJson,
  resetLlmClient,
  type ChatMessage,
  type ChatOptions,
} from './llm.js';

// 5.6 数据聚合器(SDK 内部主要流程)
export { aggregate, type AggregateOptions, type AggregateResult } from './aggregator.js';

// 5.7 数据源客户端(高级用户直接调用)
export { searchHackerNews } from './hacker-news.js';
export { searchReddit } from './reddit.js';
export { searchOpenSerp } from './open-serp.js';

// ============================================================
// 6) 共享类型(SDK-39)
// ============================================================
export type {
  ProjectStatus,
  ExecutionStatus,
  ResearchDepth,
  MarketNeedSource,
  MarketNeed,
  ReportSource,
  ReportCompetitor,
  ReportMarketHeat,
  MarketReport,
  DemandHit,
  CompetitorEntry,
  LandingPage,
  ResearchSession,
  DemandStats,
} from './types.js';

// ============================================================
// 7) 日志(SDK-49)
// ============================================================
export { logger, applyLogLevel, type Logger } from './logger.js';