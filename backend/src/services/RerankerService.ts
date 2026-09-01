/**
 * v1.4 智能化 - LLM Rerank 服务
 *
 * 目的:
 *   Aggregator 当前的排序只考虑 engagement(点赞 / 评论数),而"用户真实需求"通常
 *   不等于"热度"——一篇小众但精准回答目标问题的帖子,可能比一条高赞吐槽更有价值。
 *   本服务对聚合后的 top N 条目,让 LLM 结合"调研主题"做相关性重排,得到一个
 *   engagement-agnostic 的排序。
 *
 * 设计取舍:
 *   - 只对 top N(默认 20)做 rerank,避免 prompt 过长 / 成本失控
 *   - 只输出**索引数组**(不修改内容),让调用方按需组合(LLM 排序 × engagement)
 *   - LLM 失败时**原样返回**,主流程零感知
 *   - LLM 必须返回"每个原始索引"的合法性校验,越界 / 重复 / 缺失都视为失败回退
 *     (避免乱序导致数据错位)
 *
 * 与现有架构的衔接:
 *   - Aggregator.aggregate 末尾(切片前)调用 rerank();
 *   - 返回的 indices 数组用于重排后切片到 100 条
 */
import { z } from 'zod';
import { chatJsonWithSchemaRetry } from './llm/LLMClient.js';
import { logger } from '../logger.js';

export interface RawItemLike {
  title: string | null;
  content: string;
  url?: string | null;
  source?: string;
}

/** rerank 输出 schema;只关心索引,内容由调用方按索引取 */
export const RerankResultSchema = z.object({
  ranked_indices: z
    .array(z.number().int().nonnegative())
    .describe('按相关性从高到低排列的原始索引数组;必须覆盖所有输入索引且不重复'),
  reasoning: z
    .string()
    .min(10)
    .max(400)
    .describe('简述排序依据,便于排错 / 复盘'),
});

export type RerankResult = z.infer<typeof RerankResultSchema>;

/** 默认 rerank 上限;超过的尾部按 engagement 保留,不动 */
export const DEFAULT_RERANK_TOP_N = 20;

const SYSTEM_PROMPT = `你是市场调研相关性评估助手。
任务:基于"调研主题",对一组候选条目(标题 + 摘要)做**相关性重排**。

评估标准(按重要性排序):
1. **主题契合度**:是否直接讨论调研主题的核心问题 / 用户痛点 / 解决方案
2. **用户真实信号**:内容是否反映"用户在用 / 在吐槽 / 在求推荐",而非营销宣传
3. **信息密度**:是否提供具体场景 / 数据 / 对比,而不是空泛口号
4. 时效性 / 来源权威性作为辅助参考

输出:
- ranked_indices: 按相关性从高到低排列的"原始索引数组",必须 0-based
- 覆盖所有输入索引,无遗漏 / 无重复
- reasoning: 一句话简述排序依据(便于排错)`;

/** 把候选条目格式化为紧凑的 LLM 上下文(避免单条过长) */
function formatCandidates(items: RawItemLike[]): string {
  return items
    .map((it, i) => {
      const title = it.title ?? '(无标题)';
      const excerpt = it.content.length > 200 ? `${it.content.slice(0, 200)}...` : it.content;
      const src = it.source ?? 'unknown';
      return `[${i}] source=${src}\n    title: ${title}\n    excerpt: ${excerpt}`;
    })
    .join('\n\n');
}

function buildUserPrompt(description: string, candidates: RawItemLike[]): string {
  return `调研主题:${description}

候选条目(共 ${candidates.length} 条,索引 0-${candidates.length - 1}):

${formatCandidates(candidates)}

请按主题相关性从高到低重排,输出 ranked_indices(必须覆盖 0-${candidates.length - 1} 的全部整数)。`;
}

export const RerankerService = {
  /**
   * 对候选条目做 LLM rerank
   * @returns 重排后的索引数组;LLM 失败 / 校验失败时**返回 null**(由调用方降级)
   */
  async rerank(
    description: string,
    items: RawItemLike[],
    opts: { topN?: number } = {}
  ): Promise<{ indices: number[]; reasoning: string } | null> {
    const topN = Math.min(items.length, opts.topN ?? DEFAULT_RERANK_TOP_N);

    // 边界: 数量太少无重排必要
    if (items.length < 3 || topN < 3) return null;
    if (!description.trim()) return null;

    // 只对 topN 做 rerank;尾部保持原序
    const head = items.slice(0, topN);
    const tail = items.slice(topN);

    let result: RerankResult;
    try {
      result = await chatJsonWithSchemaRetry<RerankResult>(
        SYSTEM_PROMPT,
        buildUserPrompt(description, head),
        RerankResultSchema,
        {
          schemaName: 'rerank',
          temperature: 0.2, // 低温度,排序要稳定
          maxTokens: 500,
          maxRetries: 1,
          // v1.5 缓存: 同 (描述 + topN 内容) 哈希,7 天 TTL
          cacheMeta: { schemaName: 'rerank' },
        }
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), topN },
        'LLM rerank 失败,降级使用 engagement 排序'
      );
      return null;
    }

    // 校验: ranked_indices 必须恰好是 [0..topN-1] 的一个排列
    const expected = new Set(Array.from({ length: topN }, (_, i) => i));
    const got = new Set(result.ranked_indices);
    if (got.size !== topN) {
      logger.warn(
        { expected: topN, got: got.size },
        'rerank 索引去重后数量不匹配,降级'
      );
      return null;
    }
    for (const idx of result.ranked_indices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= topN) {
        logger.warn({ idx }, 'rerank 索引越界,降级');
        return null;
      }
      if (!expected.has(idx)) {
        logger.warn({ idx }, 'rerank 索引未在期望集合内,降级');
        return null;
      }
      expected.delete(idx);
    }
    if (expected.size > 0) {
      logger.warn({ missing: Array.from(expected) }, 'rerank 索引有遗漏,降级');
      return null;
    }

    // 拼接 head(rerank 后)+ tail(原顺序)
    const finalIndices = [...result.ranked_indices, ...tail.map((_, i) => topN + i)];
    return { indices: finalIndices, reasoning: result.reasoning };
  },
};
