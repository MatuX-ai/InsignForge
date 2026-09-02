/**
 * 数据源权重与类型映射(v1.6,v1.7 扩展中文源)
 *
 * 用途:
 *   在 MarketResearcher 生成报告时,基于本次抓取的 market_needs 按 source 分组
 *   计数并加权,产出每条 source 的"贡献度",前端可直接渲染可视化卡片。
 *
 * 设计:
 *   - 集中常量表,便于未来挪到注册表或配置中心
 *   - 权重 default 1.0,可在环境变量 INSIGHTFORGE_SOURCE_WEIGHTS 覆盖(格式: source=weight,source=weight)
 *   - type 用于前端按"论坛/搜索/社交/评测"做粗粒度分组,无需新增字段
 *   - 未知 source 默认 weight=1.0, type='search'(向前兼容)
 */
import type { MarketNeedSource } from '../../types/index.js';
import { logger } from '../../logger.js';

export type ContributionType = 'forum' | 'search' | 'social' | 'review';

/** 内置默认映射(未配置环境变量时使用) */
const DEFAULT_WEIGHTS: Record<string, { weight: number; type: ContributionType }> = {
  reddit: { weight: 1.0, type: 'social' },
  hackernews: { weight: 1.2, type: 'forum' },
  google: { weight: 1.0, type: 'search' },
  bing: { weight: 0.9, type: 'search' },
  producthunt: { weight: 1.1, type: 'review' },
  // v1.7 中文源: zhihu / juejin 为已实装;weibo / xiaohongshu 为骨架(见 DISABLED_SOURCES)
  zhihu: { weight: 1.1, type: 'forum' },
  juejin: { weight: 1.0, type: 'forum' },
  weibo: { weight: 0.8, type: 'social' },
  xiaohongshu: { weight: 0.8, type: 'social' },
};

/**
 * v1.7骨架源名单(会变)
 *
 * 原因: weibo / xiaohongshu 在匿名访问下 100% 触发风控,匿名不能接;
 * 仅作为接入骨架交付,调用 searchWeibo / searchXiaohongshu 后永远返回 []。
 *
 * 启用某个骨架源时(比如后续为团队版接 cookie 链路),必须:
 *   1. 从本数组中移除该 source;
 *   2. 同时改造对应 Client 使其走 withReliability 与 fetchWithRetry;
 *   3. 在 DEFAULT_WEIGHTS 表中同步调整权重与 type;
 *   4. 更新本处 sourceWeights.test 中的断言。
 */
export const DISABLED_SOURCES: readonly MarketNeedSource[] = ['weibo', 'xiaohongshu'];

/** 给上层报告未启用骨架源对象与其类型(供 index 启动日志 / 健康检查复用) */
export function getDisabledSourceNotes(): readonly MarketNeedSource[] {
  return DISABLED_SOURCES;
}

/** 兜底:未在映射表里的 source */
const FALLBACK = { weight: 1.0, type: 'search' as const };

/**
 * 解析环境变量 INSIGHTFORGE_SOURCE_WEIGHTS(格式: reddit=1.5,hackernews=1.0)
 * 解析失败 / 未配置返回空对象(走默认)
 */
function loadEnvOverride(): Record<string, { weight: number }> {
  const raw = process.env.INSIGHTFORGE_SOURCE_WEIGHTS;
  if (!raw || raw.trim().length === 0) return {};
  const result: Record<string, { weight: number }> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (!k || !v) continue;
    const w = Number.parseFloat(v);
    if (!Number.isFinite(w) || w <= 0) {
      logger.warn({ source: k, value: v }, 'INSIGHTFORGE_SOURCE_WEIGHTS 非法权重,忽略');
      continue;
    }
    result[k] = { weight: w };
  }
  return result;
}

/** 缓存解析结果,避免每次 computeContributions 都重读 env */
let cachedOverride: Record<string, { weight: number }> | null = null;
function getOverride(): Record<string, { weight: number }> {
  if (cachedOverride === null) cachedOverride = loadEnvOverride();
  return cachedOverride;
}

/** 仅供测试:清空缓存 */
export function _resetSourceWeightsForTest(): void {
  cachedOverride = null;
}

/**
 * 取指定 source 的配置;优先环境变量,其次默认表,再次兜底
 */
export function getSourceConfig(source: string): { weight: number; type: ContributionType } {
  const override = getOverride()[source];
  if (override) {
    return { ...FALLBACK, ...DEFAULT_WEIGHTS[source], ...override };
  }
  return DEFAULT_WEIGHTS[source] ?? FALLBACK;
}

/** 类型联合(便于前端 narrow) */
export type KnownSource = Extract<MarketNeedSource, keyof typeof DEFAULT_WEIGHTS>;
