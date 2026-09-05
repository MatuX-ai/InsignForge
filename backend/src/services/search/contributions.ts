/**
 * 数据源贡献度聚合(v1.6)
 *
 * 用途:
 *   MarketResearcher 在生成报告前,把本次落库的 market_needs 按 source 分组,
 *   计算每条 source 的 count × weight 在加权总和中的占比,产出可视化所需字段。
 *
 * 设计要点:
 *   - 无 LLM 调用,纯本地计算,不影响调研耗时
 *   - count = 该 source 在入参 needs 中的实际条数
 *   - weight 取自 sourceWeights.getSourceConfig(source)
 *   - percentage = count * weight / Σ(count_i * weight_i) * 100(权重占比)
 *   - 输出按 percentage 降序,便于前端直接渲染
 *   - needs 为空时返回空数组(与 zod .default([]) 一致,前端兜底分支)
 *
 * 与原有 MarketReportSchema 兼容:
 *   返回结构与 ReportContributionSchema 一一对应,前端 MarketReport.contributions
 *   可直接渲染。
 */
import type { MarketNeed } from '../../types/index.js';
import { getSourceConfig } from './sourceWeights.js';

export interface Contribution {
  source: string;
  type: 'forum' | 'search' | 'social' | 'review';
  count: number;
  weight: number;
  percentage: number;
}

/**
 * v1.7+: 本次调研实际尝试过的源(含命中为 0 / 骨架 / 报错均计入)。
 * 从 backend/src/services/search/Aggregator.ts 的 Promise.allSettled 数组静态推导,
 * 后续加新源时这里同步加一项;采集中粗粒度一致性由 tsc 联合类型保证。
 */
export const ATTEMPTED_SOURCES: readonly string[] = [
  'google',     // OpenSerp / SerpAPI 搜索引擎
  'hackernews', // Algolia 公开 API
  'reddit',     // reddit.com/search.json
  'zhihu',      // 知乎 search_v3(v1.7 实装)
  'juejin',     // 掘金 search(v1.7 实装)
  'weibo',      // 微博(骨架)
  'xiaohongshu',// 小红书(骨架)
];

/**
 * 计算本次调研的数据源贡献度
 * @param needs 本次调研实际落库的 market_needs 列表
 * @param attemptedSources 可选;本次调研尝试过的源(含 0 命中 / 骨架),
 *                        传入后即使该源未在 needs 中也会以 count=0 出现在结果里。
 *                        不传则保持原 v1.6 行为(只输出 needs 里有的源)。
 * @returns 按 percentage 降序的贡献度数组
 */
export function computeContributions(
  needs: MarketNeed[],
  attemptedSources?: readonly string[]
): Contribution[] {
  // 第一遍:按 source 分组 + 计算加权总和
  const buckets = new Map<string, { count: number; weight: number; weightedSum: number }>();
  let totalWeighted = 0;
  for (const n of needs) {
    const source = n.source;
    const cfg = getSourceConfig(source);
    let bucket = buckets.get(source);
    if (!bucket) {
      bucket = { count: 0, weight: cfg.weight, weightedSum: 0 };
      buckets.set(source, bucket);
    }
    bucket.count += 1;
    bucket.weightedSum += cfg.weight;
    totalWeighted += cfg.weight;
  }

  // 第二遍(可选):补齐尝试过但 0 命中的源(不参与加权占比计算,只作为诚实表达)
  if (attemptedSources && attemptedSources.length > 0) {
    for (const source of attemptedSources) {
      if (!buckets.has(source)) {
        const cfg = getSourceConfig(source);
        buckets.set(source, { count: 0, weight: cfg.weight, weightedSum: 0 });
      }
    }
  }

  // needs 为空且未传 attemptedSources:保持原 v1.6 行为,返回 []
  if (totalWeighted <= 0 && !attemptedSources) return [];

  // 第三遍:产出 Contribution 列表
  //   - 有命中的源:percentage = count*weight / Σ(命中源的 count_i*weight_i) * 100
  //   - 0 命中源:percentage = 0(不稀释非零源)
  const result: Contribution[] = [];
  for (const [source, b] of buckets.entries()) {
    const cfg = getSourceConfig(source);
    const percentage =
      totalWeighted > 0 ? Math.round((b.weightedSum / totalWeighted) * 1000) / 10 : 0;
    result.push({
      source,
      type: cfg.type,
      count: b.count,
      weight: cfg.weight,
      percentage,
    });
  }
  // 按 percentage 降序,percentage 相同时按 count 降序
  result.sort((a, b) => b.percentage - a.percentage || b.count - a.count);
  return result;
}
