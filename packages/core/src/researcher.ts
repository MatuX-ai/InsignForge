/**
 * InsightForge 核心协调器 —— InsightForgeCore(SDK 主类)
 *
 * 改编自 dsh-plugin/src/core/researcher.ts 的核心编排逻辑:
 *   1. 关键词提取 (LLM)
 *   2. 多源数据采集 (Aggregator)
 *   3. 报告生成 (LLM)
 *
 * SDK 适配点:
 * 1. 改为 standalone SDK,不再依赖 Cordis / dsh 上下文
 * 2. dispose() 方法保留(SDK-52),由调用方显式调用
 * 3. 增加 createInsightForgeCore() 工厂函数(SDK-31)
 * 4. 增加 healthCheck() 方法(SDK-51)
 * 5. 缓存、并发、数据库管理全部内聚
 *
 * 文档:05-集成扩展需求文档.md §3.1.3
 */
import { randomUUID } from 'node:crypto';
import type { Config, DepthProfile } from './config-types.js';
import { applyLogLevel, logger } from './logger.js';
import type {
  CompetitorEntry,
  MarketReport,
  MarketNeed,
  MarketNeedSource,
  ResearchDepth,
  ResearchSession,
} from './types.js';
import { SimpleLRUCache, reportCacheKey, type ReportCache } from './cache.js';
import { Semaphore } from './concurrency.js';
import { closeDb, getDb, hasSqliteBindings } from './db.js';
import { aggregate, type AggregateResult } from './aggregator.js';
import { chatJson } from './llm.js';
import {
  KeywordExtractionSchema,
  MarketReportSchema,
  type ValidatedKeywords,
  type ValidatedMarketReport,
} from './schemas/report.js';
import {
  KEYWORD_EXTRACTION_SYSTEM,
  buildKeywordExtractionUserPrompt,
} from './prompts/keyword-extractor.js';
import {
  REPORT_GENERATION_SYSTEM,
  buildReportUserPrompt,
} from './prompts/report-generator.js';

/** 三档深度对应的 LLM/搜索参数 */
const DEPTH_PROFILES: Record<ResearchDepth, DepthProfile> = {
  quick: {
    keywordCount: 3,
    keywordTokens: 300,
    maxTokens: 1500,
    searchLimit: 30,
    temperature: 0.5,
    estimatedSeconds: 60,
  },
  standard: {
    keywordCount: 5,
    keywordTokens: 500,
    maxTokens: 4000,
    searchLimit: 80,
    temperature: 0.4,
    estimatedSeconds: 180,
  },
  deep: {
    keywordCount: 8,
    keywordTokens: 800,
    maxTokens: 8000,
    searchLimit: 150,
    temperature: 0.3,
    estimatedSeconds: 360,
  },
};

export interface ResearchRequest {
  idea: string;
  depth?: ResearchDepth;
  /** 可选:关联 projectId(留空时自动生成) */
  projectId?: string;
  /** 可选:跳过缓存(默认 false) */
  noCache?: boolean;
}

export interface ResearchResult {
  report: MarketReport;
  fromCache: boolean;
  aggregate: AggregateResult;
  durationMs: number;
  sessionId: string;
}

/** SDK 健康检查结果(SDK-51) */
export interface HealthCheckResult {
  ok: boolean;
  db: boolean;
  config: boolean;
  /** 注:LLM 与搜索仅在调用时探测,healthCheck 不主动发请求 */
  llmAvailable: boolean;
  searchConfigured: boolean;
  error?: string;
}

export class InsightForgeCore {
  readonly config: Config;
  readonly semaphore: Semaphore;
  readonly reportCache: ReportCache | null;
  private sessions = new Map<string, ResearchSession>();
  private disposed = false;

  constructor(config: Config) {
    this.config = config;
    applyLogLevel(config);
    this.semaphore = new Semaphore(config.maxConcurrent);
    this.reportCache = config.cacheEnabled
      ? new SimpleLRUCache<MarketReport>(128, 24 * 60 * 60 * 1000)
      : null;
    // 触发 DB 初始化(若 dbPath 无效,此处抛错)
    if (hasSqliteBindings()) {
      getDb(config);
    } else {
      logger.warn('better-sqlite3 原生绑定不可用,跳过 DB 初始化');
    }
    logger.info(
      { provider: config.llmProvider, dbPath: config.dbPath },
      'InsightForgeCore 已初始化'
    );
  }

  /** 公开 dispose,幂等可重复调用(SDK-52) */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sessions.clear();
    this.reportCache?.clear();
    if (hasSqliteBindings()) {
      closeDb();
    }
    logger.info('InsightForgeCore 已 dispose');
  }

  /** 健康检查(SDK-51) */
  healthCheck(): HealthCheckResult {
    const result: HealthCheckResult = {
      ok: true,
      db: false,
      config: true,
      llmAvailable: false,
      searchConfigured: false,
    };

    if (this.disposed) {
      return { ...result, ok: false, error: 'InsightForgeCore 已 dispose' };
    }

    // DB 检查
    try {
      if (hasSqliteBindings()) {
        const db = getDb(this.config);
        const probe = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
        result.db = probe?.ok === 1;
      } else {
        result.db = false;
      }
    } catch (err) {
      result.db = false;
      result.error = `DB 错误: ${err instanceof Error ? err.message : String(err)}`;
    }

    // LLM 可用性:仅检查 apiKey 非空(实际调用不在 healthCheck 范围)
    result.llmAvailable =
      !!this.config.llmApiKey || this.config.llmProvider === 'ollama';

    // 搜索配置:检查 endpoint 非空
    result.searchConfigured = !!this.config.searchEndpoint?.trim();

    result.ok = result.db || !hasSqliteBindings(); // DB 不可用时也不致命(搜索/报告可仍可用)
    return result;
  }

  // ============================================================
  // 主流程
  // ============================================================

  /**
   * 全流程调研入口(对应 dsh-plugin MarketResearcher.run)
   */
  async research(req: ResearchRequest): Promise<ResearchResult> {
    if (this.disposed) throw new Error('InsightForgeCore 已 dispose,不可调用');
    const depth = req.depth ?? 'standard';
    const profile = DEPTH_PROFILES[depth];
    const sessionId = req.projectId ?? randomUUID();

    const session: ResearchSession = {
      id: sessionId,
      idea: req.idea,
      depth,
      startedAt: new Date().toISOString(),
      status: 'running',
      progress: '初始化...',
    };
    this.sessions.set(sessionId, session);

    return this.semaphore.run(async () => {
      const start = Date.now();
      try {
        // 检查缓存
        const cacheKey = reportCacheKey(req.idea, depth);
        if (this.reportCache && !req.noCache) {
          const cached = this.reportCache.get(cacheKey);
          if (cached) {
            logger.info({ sessionId, depth, cacheKey }, '命中缓存');
            session.status = 'success';
            session.progress = '命中缓存';
            return {
              report: cached,
              fromCache: true,
              aggregate: { inserted: 0, unique: 0, bySource: emptySource() },
              durationMs: Date.now() - start,
              sessionId,
            };
          }
        }

        // 步骤 1: 关键词提取
        session.progress = '正在用 AI 拆解搜索关键词...';
        const keywords = await this.extractKeywords(req.idea, depth);
        logger.info({ sessionId, keywords }, '关键词提取完成');

        // 步骤 2: 多源数据采集
        session.progress = `正在用 ${keywords.keywords.length} 个关键词并行搜索...`;
        const aggregateResult = await aggregate({
          cfg: this.config,
          keywords: keywords.keywords,
          projectId: sessionId,
          depth,
        });
        logger.info({ sessionId, inserted: aggregateResult.inserted }, '数据采集完成');

        // 步骤 3: 报告生成
        session.progress = '正在整合数据生成报告...';
        const dataContext = await this.buildContext(sessionId, profile.searchLimit);
        const report = await this.generateReport(
          req.idea,
          keywords.keywords,
          dataContext,
          depth,
          profile
        );

        // 缓存
        if (this.reportCache && !req.noCache) {
          this.reportCache.set(cacheKey, report);
        }

        session.status = 'success';
        session.progress = '完成';
        return {
          report,
          fromCache: false,
          aggregate: aggregateResult,
          durationMs: Date.now() - start,
          sessionId,
        };
      } catch (err) {
        session.status = 'failed';
        session.progress = `失败: ${err instanceof Error ? err.message : String(err)}`;
        throw err;
      }
    });
  }

  /**
   * 关键词提取(支持 fallback)
   */
  async extractKeywords(
    description: string,
    depth: ResearchDepth = 'standard'
  ): Promise<ValidatedKeywords> {
    const profile = DEPTH_PROFILES[depth];
    try {
      const raw = await chatJson<unknown>(
        this.config,
        KEYWORD_EXTRACTION_SYSTEM,
        buildKeywordExtractionUserPrompt(description),
        { temperature: 0.5, maxTokens: profile.keywordTokens }
      );
      const parsed = KeywordExtractionSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ err: parsed.error.format() }, '关键词提取结果校验失败,使用 fallback');
        return {
          keywords: fallbackKeywords(description, profile.keywordCount),
          reasoning: 'LLM 输出未通过校验,使用 fallback 分词',
        };
      }
      // 截断到 profile.keywordCount
      return {
        keywords: parsed.data.keywords.slice(0, profile.keywordCount),
        reasoning: parsed.data.reasoning,
      };
    } catch (err) {
      logger.warn({ err }, '关键词提取调用失败,使用 fallback');
      return {
        keywords: fallbackKeywords(description, profile.keywordCount),
        reasoning: 'LLM 调用失败,使用 fallback 分词',
      };
    }
  }

  /**
   * 报告生成(从已采集数据)
   */
  async generateReport(
    description: string,
    keywords: string[],
    dataContext: string,
    depth: ResearchDepth,
    profile: DepthProfile
  ): Promise<MarketReport> {
    const raw = await chatJson<unknown>(
      this.config,
      REPORT_GENERATION_SYSTEM,
      buildReportUserPrompt(description, dataContext, keywords),
      { temperature: profile.temperature, maxTokens: profile.maxTokens }
    );

    const parsed = MarketReportSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({ err: parsed.error.format() }, '报告结构校验失败');
      throw new Error(
        `LLM 返回的报告结构不符合预期:${parsed.error.issues
          .map(
            (iss: { path: Array<string | number>; message: string }) =>
              `${iss.path.join('.') || '(root)'}: ${iss.message}`
          )
          .join('; ')}`
      );
    }

    return {
      ...(parsed.data as ValidatedMarketReport),
      generated_at: new Date().toISOString(),
      depth,
      keywords,
    };
  }

  /**
   * 把需求数据格式化为 LLM 友好的纯文本
   */
  async buildContext(projectId: string, limit: number): Promise<string> {
    if (!hasSqliteBindings()) {
      return '(本次未采集到任何公开数据。better-sqlite3 原生绑定不可用)';
    }
    const db = getDb(this.config);
    const rows = db
      .prepare(
        `SELECT * FROM market_needs WHERE project_id = ?
         ORDER BY engagement DESC, crawled_at DESC LIMIT ?`
      )
      .all(projectId, limit) as MarketNeed[];

    if (rows.length === 0) {
      return '(本次未采集到任何公开数据。请基于一般行业知识与产品描述生成报告,并在 sources 中说明"基于 AI 行业知识估计")';
    }

    return rows
      .slice(0, 50)
      .map((n, i) => {
        const content = n.content.length > 400 ? `${n.content.slice(0, 400)}...` : n.content;
        return `[${i + 1}] 来源:${n.source} | 互动:${n.engagement} | 作者:${n.author ?? '匿名'}
   标题:${n.title ?? '(无)'}
   内容:${content}
   链接:${n.url ?? '(无)'}`;
      })
      .join('\n\n');
  }

  /**
   * 检索需求库(search_demand 工具后端)
   */
  searchDemand(query: string, limit = 20): MarketNeed[] {
    if (!hasSqliteBindings()) {
      logger.warn('better-sqlite3 原生绑定不可用,searchDemand 返回空');
      return [];
    }
    const db = getDb(this.config);
    try {
      const rows = db
        .prepare(
          `SELECT m.* FROM market_needs m
           JOIN market_needs_fts f ON m.rowid = f.rowid
           WHERE market_needs_fts MATCH ?
           ORDER BY rank LIMIT ?`
        )
        .all(`${query}*`, limit) as MarketNeed[];
      return rows;
    } catch (err) {
      logger.warn({ err, query }, 'FTS5 检索失败,降级为 LIKE 查询');
      // 兜底:LIKE 查询
      const likeRows = db
        .prepare(
          `SELECT * FROM market_needs WHERE content LIKE ? OR title LIKE ?
           ORDER BY engagement DESC LIMIT ?`
        )
        .all(`%${query}%`, `%${query}%`, limit) as MarketNeed[];
      return likeRows;
    }
  }

  /**
   * 需求库统计(预留 insightforge/demand 服务)
   */
  demandStats(): { total: number; bySource: Partial<Record<MarketNeedSource, number>> } {
    if (!hasSqliteBindings()) {
      return { total: 0, bySource: {} };
    }
    const db = getDb(this.config);
    const total = (db.prepare(`SELECT COUNT(*) as c FROM market_needs`).get() as { c: number }).c;
    const rows = db
      .prepare(`SELECT source, COUNT(*) as c FROM market_needs GROUP BY source`)
      .all() as Array<{ source: MarketNeedSource; c: number }>;
    const bySource: Partial<Record<MarketNeedSource, number>> = {};
    for (const r of rows) bySource[r.source] = r.c;
    return { total, bySource };
  }

  /**
   * 创建调研会话(预留 insightforge/session 服务)
   */
  createSession(idea: string, depth: ResearchDepth): ResearchSession {
    const session: ResearchSession = {
      id: randomUUID(),
      idea,
      depth,
      startedAt: new Date().toISOString(),
      status: 'pending',
      progress: '',
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * 获取会话状态
   */
  getSession(id: string): ResearchSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * 聚焦竞品分析(competitor_analysis 工具后端)
   *
   * 复用 extractKeywords + aggregate,然后用更短的 prompt 让 LLM 抽取
   * 竞品维度的子集(避免完整报告冗余)。
   */
  async analyzeCompetitors(domain: string, limit = 8): Promise<CompetitorEntry[]> {
    if (!domain.trim()) throw new Error('domain 不能为空');
    const projectId = randomUUID();
    const keywords = await this.extractKeywords(`competitors of ${domain}`, 'standard');
    const aggregateResult = await aggregate({
      cfg: this.config,
      keywords: keywords.keywords,
      projectId,
      depth: 'standard',
      skipPersist: false,
    });
    const ctx = await this.buildContext(projectId, aggregateResult.unique);

    // 让 LLM 抽取竞品子集
    const prompt = `基于以下关于 "${domain}" 领域的公开数据,提取 ${limit} 个最相关的竞品。
要求严格返回 JSON,字段:[{"name": "", "description": "", "url": "", "strengths": [], "weaknesses": [], "market_position": "leader|challenger|niche", "source_urls": []}]

数据:
${ctx}`;

    try {
      const raw = await chatJson<unknown>(
        this.config,
        '你是一位行业分析师,擅长从公开数据中识别竞品及其市场定位。',
        prompt,
        { temperature: 0.3, maxTokens: 3000 }
      );
      if (!Array.isArray(raw)) return [];
      return (raw as CompetitorEntry[]).slice(0, limit);
    } catch (err) {
      logger.warn({ err, domain }, '竞品分析失败');
      return [];
    }
  }
}

/** 工厂函数(SDK-31) */
export function createInsightForgeCore(config: Config): InsightForgeCore {
  return new InsightForgeCore(config);
}

function emptySource(): Record<MarketNeedSource, number> {
  return { reddit: 0, hackernews: 0, google: 0, bing: 0, producthunt: 0 };
}

function fallbackKeywords(description: string, count: number): string[] {
  const enWords = description
    .toLowerCase()
    .match(/[a-z]{3,}/g)
    ?.slice(0, count) ?? [];
  const cnWords = description
    .replace(/[a-zA-Z0-9\s\p{P}]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, count);

  const combined = [...enWords, ...cnWords].slice(0, count);
  return combined.length > 0 ? combined : [description.slice(0, 30)];
}

/** 供外部访问档位配置 */
export function getDepthProfile(depth: ResearchDepth): DepthProfile {
  return DEPTH_PROFILES[depth];
}
