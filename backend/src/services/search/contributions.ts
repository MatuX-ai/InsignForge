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
 * 计算本次调研的数据源贡献度
 * @param needs 本次调研实际落库的 market_needs 列表
 * @returns 按 percentage 降序的贡献度数组;needs 为空时返回 []
 */
export function computeContributions(needs: MarketNeed[]): Contribution[] {
  if (needs.length === 0) return [];

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
  if (totalWeighted <= 0) return [];

  // 第二遍:产出 Contribution 列表
  const result: Contribution[] = [];
  for (const [source, b] of buckets.entries()) {
    const cfg = getSourceConfig(source);
    result.push({
      source,
      type: cfg.type,
      count: b.count,
      weight: cfg.weight,
      // 保留 1 位小数,避免浮点抖动;占比保持和为 100(允许 0.1 误差)
      percentage: Math.round((b.weightedSum / totalWeighted) * 1000) / 10,
    });
  }
  // 按 percentage 降序,percentage 相同时按 count 降序
  result.sort((a, b) => b.percentage - a.percentage || b.count - a.count);
  return result;
}
