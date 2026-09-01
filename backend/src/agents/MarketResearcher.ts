/**
 * 市场调研员智能体 (MarketResearcher)
 *
 * 协调整个调研流程:
 *   1. 关键词提取 (LLM)
 *   2. 数据采集 (Aggregator)
 *   3. 报告生成 (LLM)
 *
 * 注: 直接使用 LLMClient 调用 OpenAI 兼容 API,而非引入 Mastra 框架
 *     Mastra 是 @mastra/core 的运行时,会增加额外复杂度
 *     MVP 阶段 LLM 调用的编排逻辑很轻,自行实现更直接
 *     后续 v1.2 可考虑迁移到 Mastra 以获得 Studio UI 与 MCP 集成
 */
import { chatJsonWithSchemaRetry } from '../services/llm/LLMClient.js';
import { Aggregator } from '../services/search/Aggregator.js';
import { MarketNeedService } from '../services/MarketNeedService.js';
import { KeywordExpansionService } from '../services/KeywordExpansionService.js';
import { PainPointExtractor } from '../services/PainPointExtractor.js';
import { computeContributions } from '../services/search/contributions.js';
import { logger } from '../logger.js';
import {
  KEYWORD_EXTRACTION_SYSTEM,
  buildKeywordExtractionUserPrompt,
} from './prompts/keywordExtractor.js';
import {
  REPORT_GENERATION_SYSTEM,
  buildReportUserPrompt,
} from './prompts/reportGenerator.js';
import {
  KeywordExtractionSchema,
  MarketReportSchema,
  type ValidatedKeywords,
  type ValidatedMarketReport,
} from './schemas/ReportSchema.js';
import type { MarketReport } from '../types/index.js';

/**
 * v1.4 智能化开关:默认开启三层 AI 增强,失败时优雅降级不影响主流程
 * - KEYWORD_EXPANSION_ENABLED: LLM 同义 / 长尾词扩展
 * - PAIN_POINT_EXTRACTION_ENABLED: 独立痛点抽取(作为报告生成的前置信号)
 *
 * 设计取舍: 环境变量控制 + 默认开启,避免热更新的复杂度;
 * 任何阶段失败都返回原数据,主流程零感知。
 */
function isEnabled(name: string, def = true): boolean {
  const raw = process.env[name];
  if (raw == null) return def;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}
const KEYWORD_EXPANSION_ENABLED = isEnabled('INSIGHTFORGE_KEYWORD_EXPANSION');
const PAIN_POINT_EXTRACTION_ENABLED = isEnabled('INSIGHTFORGE_PAIN_POINT_EXTRACTION');

export interface ResearchInput {
  projectId: string;
  description: string;
}

export const MarketResearcher = {
  /**
   * 全流程调研入口
   * @param onStep 每完成一步回调(用于更新项目进度)
   */
  async run(
    input: ResearchInput,
    onStep?: (step: string) => void
  ): Promise<MarketReport> {
    const { projectId, description } = input;

    // ---------- 步骤 1: 关键词提取 ----------
    onStep?.('正在用 AI 拆解搜索关键词...');
    const keywordsResult = await this.extractKeywords(description);
    let keywords = keywordsResult.keywords;
    logger.info({ keywords, reasoning: keywordsResult.reasoning }, '关键词提取完成');

    // ---------- 步骤 1.5: 关键词扩展 (v1.4 智能化) ----------
    if (KEYWORD_EXPANSION_ENABLED && keywords.length > 0) {
      onStep?.(`正在扩展同义词 / 长尾词(原 ${keywords.length} 个)...`);
      const expansion = await KeywordExpansionService.expand(description, keywords);
      if (expansion.expanded) {
        logger.info(
          {
            before: keywords.length,
            after: expansion.keywords.length,
            added: expansion.keywords.length - keywords.length,
            reasoning: expansion.reasoning,
          },
          '关键词扩展生效'
        );
        onStep?.(`关键词扩展 +${expansion.keywords.length - keywords.length} → ${expansion.keywords.length} 个`);
        keywords = expansion.keywords;
      }
    }

    // ---------- 步骤 2: 多源数据采集 ----------
    // 传入 description 触发 v1.4 LLM rerank;失败自动降级到 engagement 排序
    onStep?.(`正在用 ${keywords.length} 个关键词并行搜索...`);
    const insertedCount = await Aggregator.aggregateAndPersist(keywords, projectId, {
      description,
    });
    logger.info({ insertedCount, projectId }, '数据采集完成');

    if (insertedCount === 0) {
      logger.warn({ projectId }, '未采集到任何数据,生成"无数据"占位报告');
      // 即使没数据,也基于 LLM 自身知识生成基础报告
    }

    // ---------- 步骤 2.5: 痛点抽取 (v1.4 智能化) ----------
    // 取 top 60 做信号抽取,作为报告生成的"已知痛点"上下文
    let painPointsCtx = '';
    if (PAIN_POINT_EXTRACTION_ENABLED) {
      const needsForExtraction = MarketNeedService.listByProject(projectId, 60);
      if (needsForExtraction.length >= 2) {
        onStep?.('正在用 AI 抽取用户痛点...');
        const pp = await PainPointExtractor.extract(
          description,
          needsForExtraction
        );
        if (pp.painPoints.length > 0) {
          painPointsCtx = pp.painPoints
            .map(
              (p, i) =>
                `${i + 1}. [${p.intensity.toUpperCase()}] ${p.text}\n   (证据:条目 #${p.evidence.join(', #')})`
            )
            .join('\n');
          logger.info(
            { count: pp.painPoints.length, summary: pp.summary },
            '痛点抽取生效'
          );
          onStep?.(`已抽取 ${pp.painPoints.length} 条结构化痛点`);
        }
      }
    }

    // ---------- 步骤 3: 报告生成 ----------
    onStep?.('正在整合数据生成报告...');
    const needs = MarketNeedService.listByProject(projectId, 60);
    const dataContext = this.formatNeedsAsContext(needs);
    const report = await this.generateReport(description, keywords, dataContext, painPointsCtx);

    // ---------- 步骤 3.5: 贡献度聚合(v1.6) ----------
    // 基于本次实际落库的 market_needs 算每条 source 的 count/weight/percentage,
    // 写到 report.contributions,前端无需再次统计
    const contributions = computeContributions(needs);
    if (contributions.length > 0) {
      logger.info(
        {
          projectId,
          contributions: contributions.map((c) => `${c.source}:${c.count}(${c.percentage}%)`),
        },
        '数据源贡献度聚合完成'
      );
    }
    (report as MarketReport).contributions = contributions;

    logger.info({ projectId }, '报告生成完成');
    return report;
  },

  /** 关键词提取 */
  async extractKeywords(description: string): Promise<ValidatedKeywords> {
    try {
      // chatJsonWithSchemaRetry 内部已做 zod 校验 + 有限次重试
      const parsed = await chatJsonWithSchemaRetry<ValidatedKeywords>(
        KEYWORD_EXTRACTION_SYSTEM,
        buildKeywordExtractionUserPrompt(description),
        KeywordExtractionSchema,
        {
          schemaName: 'keyword-extraction',
          temperature: 0.5,
          maxTokens: 500,
          maxRetries: 2,
          // v1.5 缓存: 同描述的关键词提取可复用,7 天 TTL
          cacheMeta: { schemaName: 'keyword-extraction' },
        }
      );
      return parsed;
    } catch (err) {
      // 兜底: 失败时直接从描述中抽取词组,保证主流程不挂
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '关键词提取失败,使用 fallback 分词'
      );
      return {
        keywords: this.fallbackKeywords(description),
        reasoning: 'LLM 输出未通过校验,使用 fallback 分词',
      };
    }
  },

  /** 报告生成 */
  async generateReport(
    description: string,
    keywords: string[],
    dataContext: string,
    painPointsContext = ''
  ): Promise<MarketReport> {
    // chatJsonWithSchemaRetry 内部已做 zod 校验,直接返回类型安全的数据
    const parsed = await chatJsonWithSchemaRetry<ValidatedMarketReport>(
      REPORT_GENERATION_SYSTEM,
      buildReportUserPrompt(description, dataContext, keywords, painPointsContext),
      MarketReportSchema,
      {
        schemaName: 'market-report',
        temperature: 0.4,
        maxTokens: 4000,
        maxRetries: 2,
        // v1.5 缓存: 同输入的报告生成可复用,7 天 TTL
        cacheMeta: { schemaName: 'market-report' },
      }
    );

    // 补全 generated_at 字段(LLM 不会输出这个)
    return { ...parsed, generated_at: new Date().toISOString() };
  },

  /** 把 MarketNeed 列表格式化为 LLM 友好的纯文本 */
  formatNeedsAsContext(needs: ReturnType<typeof MarketNeedService.listByProject>): string {
    if (needs.length === 0) {
      return '(本次未采集到任何公开数据。请基于一般行业知识与产品描述生成报告,并在 sources 中说明"基于 AI 行业知识估计")';
    }

    return needs
      .slice(0, 50)
      .map((n, i) => {
        const content = n.content.length > 400 ? `${n.content.slice(0, 400)}...` : n.content;
        return `[${i + 1}] 来源:${n.source} | 互动:${n.engagement} | 作者:${n.author ?? '匿名'}
   标题:${n.title ?? '(无)'}
   内容:${content}
   链接:${n.url ?? '(无)'}`;
      })
      .join('\n\n');
  },

  /** 兜底关键词(LLM 不可用时使用) */
  fallbackKeywords(description: string): string[] {
    // 提取英文单词与中文 n-gram
    const enWords = description
      .toLowerCase()
      .match(/[a-z]{3,}/g)
      ?.slice(0, 4) ?? [];
    const cnWords = description
      .replace(/[a-zA-Z0-9\s\p{P}]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .slice(0, 4);

    const combined = [...enWords, ...cnWords].slice(0, 5);
    return combined.length > 0 ? combined : [description.slice(0, 30)];
  },
};