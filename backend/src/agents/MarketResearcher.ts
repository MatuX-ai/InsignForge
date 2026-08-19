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
import { chatJson } from '../services/llm/LLMClient.js';
import { Aggregator } from '../services/search/Aggregator.js';
import { MarketNeedService } from '../services/MarketNeedService.js';
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
    const keywords = keywordsResult.keywords;
    logger.info({ keywords, reasoning: keywordsResult.reasoning }, '关键词提取完成');

    // ---------- 步骤 2: 多源数据采集 ----------
    onStep?.(`正在用 ${keywords.length} 个关键词并行搜索...`);
    const insertedCount = await Aggregator.aggregateAndPersist(keywords, projectId);
    logger.info({ insertedCount, projectId }, '数据采集完成');

    if (insertedCount === 0) {
      logger.warn({ projectId }, '未采集到任何数据,生成"无数据"占位报告');
      // 即使没数据,也基于 LLM 自身知识生成基础报告
    }

    // ---------- 步骤 3: 报告生成 ----------
    onStep?.('正在整合数据生成报告...');
    const needs = MarketNeedService.listByProject(projectId, 60);
    const dataContext = this.formatNeedsAsContext(needs);
    const report = await this.generateReport(description, keywords, dataContext);

    logger.info({ projectId }, '报告生成完成');
    return report;
  },

  /** 关键词提取 */
  async extractKeywords(description: string): Promise<ValidatedKeywords> {
    const raw = await chatJson<unknown>(
      KEYWORD_EXTRACTION_SYSTEM,
      buildKeywordExtractionUserPrompt(description),
      { temperature: 0.5, maxTokens: 500 }
    );
    const parsed = KeywordExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ err: parsed.error.format(), raw }, '关键词提取结果校验失败,使用 fallback');
      // 兜底:直接从描述中抽取词组
      return {
        keywords: this.fallbackKeywords(description),
        reasoning: 'LLM 输出未通过校验,使用 fallback 分词',
      };
    }
    return parsed.data;
  },

  /** 报告生成 */
  async generateReport(
    description: string,
    keywords: string[],
    dataContext: string
  ): Promise<MarketReport> {
    const raw = await chatJson<unknown>(
      REPORT_GENERATION_SYSTEM,
      buildReportUserPrompt(description, dataContext, keywords),
      { temperature: 0.4, maxTokens: 4000 }
    );

    const parsed = MarketReportSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({ err: parsed.error.format(), raw }, '报告结构校验失败');
      throw new Error(
        `LLM 返回的报告结构不符合预期:${parsed.error.issues
          .map((i) => i.message)
          .join('; ')}`
      );
    }

    // 补全 generated_at 字段(LLM 不会输出这个)
    return { ...parsed.data, generated_at: new Date().toISOString() };
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