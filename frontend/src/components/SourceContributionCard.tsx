/**
 * 数据源贡献度卡片(v1.6)
 *
 * 渲染单条 source 在本次调研中的 count/weight/percentage,
 * 用于 Report 页「数据来源」卡片的可视化网格。
 *
 * 视觉:
 *   - 类型 chip: forum / search / social / review 用不同颜色区分
 *   - 来源名 + 图标
 *   - 进度条: 按 percentage 渲染
 *   - 数值: count 条 + weight 倍 + 百分比
 */
import type { ReportContribution } from '../types';

/** 来源标识 → 友好图标(避免表情差异,统一用 emoji) */
const SOURCE_ICON: Record<string, string> = {
  reddit: '🟠',
  hackernews: '🟧',
  google: '🔍',
  bing: '🔎',
  producthunt: '🚀',
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
  // 宽度按 percentage 真实值,但相对最大条做下限保护(避免 0.5% 看不见)
  const baseWidth = maxPercentage > 0 ? (contribution.percentage / maxPercentage) * 100 : 100;

  return (
    <div className="border border-border rounded-lg p-4 bg-card-solid/30 backdrop-blur-sm flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0" aria-hidden>
            {icon}
          </span>
          <span className="font-medium text-text-primary truncate">{contribution.source}</span>
        </div>
        <span
          className={`px-2 py-0.5 text-helper rounded-md border ${typeMeta.cls} flex-shrink-0`}
        >
          {typeMeta.label}
        </span>
      </div>

      <div className="bg-slate-700/40 rounded-full h-2 overflow-hidden">
        <div
          className="bg-gradient-to-r from-primary to-primary-light h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(baseWidth, 2)}%` }}
          aria-label={`${contribution.source} 贡献度 ${contribution.percentage}%`}
        />
      </div>

      <div className="flex items-center justify-between text-helper text-text-secondary tabular-nums">
        <span>
          <span className="text-text-primary font-medium">{contribution.count}</span> 条
        </span>
        <span>权重 ×{contribution.weight}</span>
        <span className="text-primary-light font-medium">{contribution.percentage}%</span>
      </div>
    </div>
  );
}
