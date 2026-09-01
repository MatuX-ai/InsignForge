/**
 * v1.4 智能化 - 关键词扩展服务
 *
 * 目的:
 *   MarketResearcher.extractKeywords 输出的关键词往往粒度偏粗(2-5 个),
 *   对小众细分领域召回不足。本服务用 LLM 在原关键词基础上做"同义词 + 长尾词"扩展,
 *   把搜索面拓宽 1.5-2 倍,而不引入更多搜索源。
 *
 * 设计取舍:
 *   - 不替换原始关键词,只在原集合上**追加**;调用方做去重
 *   - 失败时**原样返回**(不抛错、不影响主流程);LLM 不可用是已知边界
 *   - 限制扩展数量(默认 +6),避免 prompt/响应膨胀与过度发散
 *   - 不引入新依赖,复用 chatJsonWithSchemaRetry + zod schema
 *
 * 与现有架构的衔接:
 *   - MarketResearcher.run 在 extractKeywords 后调用 expand()
 *   - Aggregator 内部已用 Set 去重关键词,所以传入重复也能正确去重
 */
import { z } from 'zod';
import { chatJsonWithSchemaRetry } from './llm/LLMClient.js';
import { logger } from '../logger.js';

/** 关键词扩展的 zod schema,作为 schemaName 用于 retry 指标聚合 */
export const KeywordExpansionSchema = z.object({
  keywords: z
    .array(z.string().min(1).max(60))
    // 限定数量,防止 LLM "倾倒" 一长串无关词
    .max(12)
    .describe('新增的同义词 / 长尾词 / 细分场景词;不要重复原始关键词'),
  reasoning: z
    .string()
    .min(10)
    .max(400)
    .describe('一句话说明扩展思路,便于排错'),
});

export type KeywordExpansion = z.infer<typeof KeywordExpansionSchema>;

/** 默认最大扩展数量;超出的会被截断 */
export const DEFAULT_KEYWORD_EXPANSION_LIMIT = 6;

const SYSTEM_PROMPT = `你是市场调研关键词扩展助手。
任务:基于用户提供的"原始关键词"和"调研主题",生成 ${DEFAULT_KEYWORD_EXPANSION_LIMIT} 个左右的新关键词,
用于在搜索引擎和社交平台上发现更多长尾 / 同义 / 细分场景的讨论。

要求:
1. **不要**重复原始关键词,只输出新词
2. 包含中文 / 英文两种形式(目标受众可能跨语种)
3. 优先选择"用户真实在用的口语化表达",而不是行业术语
4. 覆盖 1-2 个细分场景(例如按人群 / 行业 / 价格段切分)
5. 每个关键词不超过 12 个字符(或 4 个英文单词)
6. reasoning 字段用一句话说明扩展思路(便于排错)`;

function buildUserPrompt(description: string, baseKeywords: string[]): string {
  return `调研主题:${description}

原始关键词(已用于搜索,无需重复):${JSON.stringify(baseKeywords, null, 2)}

请输出"新增"关键词(同义 / 长尾 / 细分场景),并简述扩展思路。`;
}

export const KeywordExpansionService = {
  /**
   * 用 LLM 扩展关键词
   * @returns 扩展后的关键词数组(原关键词 + 新关键词,已去重);
   *          LLM 失败时**降级为原样返回**
   */
  async expand(
    description: string,
    baseKeywords: string[],
    opts: { limit?: number } = {}
  ): Promise<{ keywords: string[]; reasoning: string; expanded: boolean }> {
    const limit = opts.limit ?? DEFAULT_KEYWORD_EXPANSION_LIMIT;

    // 边界: 空描述 / 空原关键词,直接返回
    if (!description.trim() || baseKeywords.length === 0) {
      return { keywords: baseKeywords, reasoning: 'empty input, skip expansion', expanded: false };
    }

    let result: KeywordExpansion;
    try {
      result = await chatJsonWithSchemaRetry<KeywordExpansion>(
        SYSTEM_PROMPT,
        buildUserPrompt(description, baseKeywords),
        KeywordExpansionSchema,
        {
          schemaName: 'keyword-expansion',
          temperature: 0.6,
          maxTokens: 600,
          maxRetries: 1,
          // v1.5 缓存: 同 (描述 + 关键词) 哈希,7 天 TTL
          cacheMeta: { schemaName: 'keyword-expansion' },
        }
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), baseKeywords },
        '关键词扩展失败,降级使用原关键词'
      );
      return {
        keywords: baseKeywords,
        reasoning: 'LLM 调用失败,降级使用原关键词',
        expanded: false,
      };
    }

    // 1. 标准化: 去首尾空白 / 小写去重 / 过滤空串
    const baseSet = new Set(baseKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean));
    const newKeywords: string[] = [];
    for (const raw of result.keywords) {
      const cleaned = raw.trim();
      if (!cleaned) continue;
      if (baseSet.has(cleaned.toLowerCase())) continue; // 与原词重复
      if (newKeywords.some((k) => k.toLowerCase() === cleaned.toLowerCase())) continue; // 自身重复
      newKeywords.push(cleaned);
      if (newKeywords.length >= limit) break;
    }

    return {
      keywords: [...baseKeywords, ...newKeywords],
      reasoning: result.reasoning,
      expanded: newKeywords.length > 0,
    };
  },
};
