/**
 * 数据源贡献度卡片(v1.6,v1.7+ 支持 0 命中源灰显)
 *
 * 渲染单条 source 在本次调研中的 count/weight/percentage,
 * 用于 Report 页「数据来源」卡片的可视化网格。
 *
 * 视觉:
 *   - 类型 chip: forum / search / social / review 用不同颜色区分
 *   - 来源名 + 图标
 *   - 进度条: 按 percentage 渲染(count=0 时灰显)
 *   - 数值: count 条 + weight 倍 + 百分比
 *     - count=0 时追加「未命中」标记,避免 "100% HN" 假象
 *
 * 依赖 sourceWeights.DEFAULT_WEIGHTS 同名字段是 union-safe 的:
 *   后端已发回 ATTEMPTED_SOURCES 所有尝试过的源(含骨架 / 报错),
 *   即使 0 命中也能在卡上看到。
 */
import type { ReportContribution } from '../types';

/** 0 命中源灰显样式:进度条 + 标签统一颜色区分 */
const EMPTY_STATE_CLS = {
  card: 'opacity-60',
  bar: 'bg-slate-600',
  pct: 'text-text-secondary',
  count: 'text-warning',
  chip: 'border-warning/40 text-warning bg-warning/5',
};

/** 来源标识 → 友好图标(避免表情差异,统一用 emoji) */
const SOURCE_ICON: Record<string, string> = {
  reddit: '🟠',
  hackernews: '🟧',
  google: '🔍',
  bing: '🔎',
  producthunt: '🚀',
  // v1.7 中文源:按平台主色挑 emoji;骨架源也展示避免遇到 0 条时名片错乱
  zhihu: '🟦',
  juejin: '🟪',
  weibo: '🔴',
  xiaohongshu: '📕',
};

/** 类型 → 中文 + 颜色 */
const TYPE_META: Record<ReportContribution['type'], { label: string; cls: string }> = {
  forum: { label: '论坛', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  search: { label: '搜索', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  social: { label: '社交', cls: 'bg-purple-500/10 text-purple-300 border-purple-500/30' },
  review: { label: '评测', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
};

export function SourceContributionCard({
  contribution,
  maxPercentage,
}: {
  contribution: ReportContribution;
  /** 整个贡献度数组里最大的 percentage(用于相对宽度,避免长尾被压平) */
  maxPercentage: number;
}) {
  const icon = SOURCE_ICON[contribution.source] ?? '📊';
  const typeMeta = TYPE_META[contribution.type];
  // v1.7+: 0 命中源走灰显路径,不画渐变进度条
  const isEmpty = contribution.count === 0;
  // 宽度按 percentage 真实值,但相对最大条做下限保护(避免 0.5% 看不见)
  const baseWidth = maxPercentage > 0 ? (contribution.percentage / maxPercentage) * 100 : 100;

  return (
    <div
      className={`border border-border rounded-lg p-4 bg-card-solid/30 backdrop-blur-sm flex flex-col gap-2 ${
        isEmpty ? EMPTY_STATE_CLS.card : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0" aria-hidden>
            {icon}
          </span>
          <span className="font-medium text-text-primary truncate">{contribution.source}</span>
          {/* v1.7+: 0 命中时追加「未命中」标记,提醒本次该源贡献为 0 */}
          {isEmpty && (
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded border ${EMPTY_STATE_CLS.chip} flex-shrink-0`}
              title="本次调研该源尝试过但未返回任何命中条目(匿名风控 / 端点变更 / 骨架源 等)"
            >
              未命中
            </span>
          )}
        </div>
        <span
          className={`px-2 py-0.5 text-helper rounded-md border ${typeMeta.cls} flex-shrink-0`}
        >
          {typeMeta.label}
        </span>
      </div>

      <div className="bg-slate-700/40 rounded-full h-2 overflow-hidden">
        {/* v1.7+: 0 命中源不画渐变进度条,改用灰色块表示"被尝试但无数据" */}
        {isEmpty ? (
          <div className={`${EMPTY_STATE_CLS.bar} h-full rounded-full`} style={{ width: '100%' }} />
        ) : (
          <div
            className="bg-gradient-to-r from-primary to-primary-light h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.max(baseWidth, 2)}%` }}
            aria-label={`${contribution.source} 贡献度 ${contribution.percentage}%`}
          />
        )}
      </div>

      <div className="flex items-center justify-between text-helper text-text-secondary tabular-nums">
        <span>
          <span className={`font-medium ${isEmpty ? EMPTY_STATE_CLS.count : 'text-text-primary'}`}>
            {contribution.count}
          </span>{' '}
          条
        </span>
        <span>权重 ×{contribution.weight}</span>
        <span
          className={`font-medium ${isEmpty ? EMPTY_STATE_CLS.pct : 'text-primary-light'}`}
        >
          {contribution.percentage}%
        </span>
      </div>
    </div>
  );
}
