/**
 * v1.4 智能化 - 痛点抽取服务
 *
 * 目的:
 *   MarketReport.pain_points 当前由"报告生成 LLM"一次性产出,与采集数据耦合较深;
 *   当 LLM 偶发"幻觉"或数据较稀疏时,容易遗漏真实痛点。本服务从聚合数据中**独立**
 *   抽取结构化痛点,作为"前置信号"注入到后续报告生成的 prompt 中,
 *   让最终报告的痛点部分有据可循、可回溯。
 *
 * 痛点结构:
 *   - text: 一句话痛点描述(用户视角)
 *   - intensity: high / mid / low,反映痛点被提及的频度与情绪强度
 *   - evidence: 引用条目索引数组,可回溯到原始 MarketNeed
 *
 * 设计取舍:
 *   - 输入是聚合后的 top N(默认 30)条目;过多会让 LLM 注意力分散
 *   - LLM 失败时返回空数组,主流程不受影响(报告会跳过痛点增强段)
 *   - 不做去重,保留 LLM 视角的"独立痛点"颗粒度;调用方可按需聚合
 *   - evidence 必须落在 [0..N-1] 内,越界视为失败回退
 *
 * 与现有架构的衔接:
 *   - MarketResearcher.run 在 report 生成前调用 extract()
 *   - 结果作为"已知痛点"注入到 report prompt,引导 LLM 沿用而非重抽
 */
import { z } from 'zod';
import { chatJsonWithSchemaRetry } from './llm/LLMClient.js';
import { logger } from '../logger.js';

export interface PainPointEvidence {
  /** 痛点的一句话描述(用户视角) */
  text: string;
  /** 强烈程度: high(集中吐槽) / mid(零星提及) / low(边缘观察) */
  intensity: 'high' | 'mid' | 'low';
  /** 证据条目在输入数组中的索引(用于回溯到 MarketNeed) */
  evidence: number[];
}

export const PainPointSchema = z.object({
  pain_points: z
    .array(
      z.object({
        text: z.string().min(4).max(200).describe('用户视角的一句话痛点描述'),
        intensity: z
          .enum(['high', 'mid', 'low'])
          .describe('强烈程度:high=集中吐槽;mid=零星提及;low=边缘观察'),
        evidence: z
          .array(z.number().int().nonnegative())
          .describe('证据条目在输入数组中的索引;至少 1 个'),
      })
    )
    // 上限防止 LLM 倾倒
    .max(12)
    .describe('抽取到的痛点列表;按强度从高到低排列'),
  summary: z
    .string()
    .min(10)
    .max(400)
    .describe('一句话总结用户痛点的总体特征,便于排错'),
});

export type PainPointResult = z.infer<typeof PainPointSchema>;

/** 默认抽取上限;超过的尾部不参与(LLM 注意力有限) */
export const DEFAULT_PAIN_POINT_INPUT_LIMIT = 30;

const SYSTEM_PROMPT = `你是市场调研痛点抽取助手。
任务:基于"调研主题"和一组候选条目,抽取**用户视角的真实痛点**。

抽取要求:
1. 只输出用户**真实在抱怨 / 求解决方案**的内容,不是产品功能或营销宣传
2. 每条痛点配 evidence: 引用最能代表该痛点的条目索引(至少 1 个)
3. intensity 区分:
   - high: 多个条目反复出现,或情绪激烈(吐槽 / 求救)
   - mid:  2-3 个条目零星提及
   - low:  单一 / 边缘观察
4. 痛点之间尽量"互斥",同一问题的不同表述合并为一条
5. 按 intensity 从高到低排序(high → mid → low)

输出:
- pain_points: 结构化痛点数组
- summary: 一句话总结痛点共性`;

/** 把条目格式化为 LLM 友好的紧凑文本 */
function formatItems(items: RawItemLike[]): string {
  return items
    .map((it, i) => {
      const title = it.title ?? '(无标题)';
      const excerpt = it.content.length > 240 ? `${it.content.slice(0, 240)}...` : it.content;
      const src = it.source ?? 'unknown';
      return `[${i}] ${src} | ${title}\n    ${excerpt}`;
    })
    .join('\n\n');
}

function buildUserPrompt(description: string, items: RawItemLike[]): string {
  return `调研主题:${description}

候选条目(共 ${items.length} 条,索引 0-${items.length - 1}):

${formatItems(items)}

请抽取用户真实痛点,每条带 evidence(原始条目索引)。`;
}

export const PainPointExtractor = {
  /**
   * 从聚合条目中抽取结构化痛点
   * @returns 痛点数组;LLM 失败 / 校验失败时**返回空数组**
   */
  async extract(
    description: string,
    items: RawItemLike[],
    opts: { limit?: number } = {}
  ): Promise<{ painPoints: PainPointEvidence[]; summary: string }> {
    const limit = Math.min(items.length, opts.limit ?? DEFAULT_PAIN_POINT_INPUT_LIMIT);

    // 边界: 数据太少 / 无描述,直接返回空
    if (items.length < 2 || limit < 2) {
      return { painPoints: [], summary: '输入数据不足,跳过痛点抽取' };
    }
    if (!description.trim()) {
      return { painPoints: [], summary: '缺少调研主题,跳过痛点抽取' };
    }

    const head = items.slice(0, limit);

    let result: PainPointResult;
    try {
      result = await chatJsonWithSchemaRetry<PainPointResult>(
        SYSTEM_PROMPT,
        buildUserPrompt(description, head),
        PainPointSchema,
        {
          schemaName: 'pain-point-extract',
          temperature: 0.3,
          maxTokens: 1500,
          maxRetries: 1,
          // v1.5 缓存: 同 (描述 + 候选条目) 哈希,7 天 TTL
          cacheMeta: { schemaName: 'pain-point-extract' },
        }
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), limit },
        '痛点抽取失败,降级返回空数组'
      );
      return { painPoints: [], summary: 'LLM 调用失败,跳过痛点抽取' };
    }

    // 校验: evidence 索引必须在 [0..limit-1] 内
    const validated: PainPointEvidence[] = [];
    for (const pp of result.pain_points) {
      if (pp.evidence.length === 0) continue;
      const filteredEvidence = pp.evidence.filter(
        (idx) => Number.isInteger(idx) && idx >= 0 && idx < limit
      );
      if (filteredEvidence.length === 0) continue; // 全是无效索引,丢掉
      validated.push({
        text: pp.text.trim(),
        intensity: pp.intensity,
        evidence: filteredEvidence,
      });
    }

    return { painPoints: validated, summary: result.summary };
  },
};

/** 给 RerankerService 复用的最小条目类型(局部 import,避免循环依赖) */
interface RawItemLike {
  title: string | null;
  content: string;
  url?: string | null;
  source?: string;
}
