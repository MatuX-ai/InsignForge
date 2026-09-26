/**
 * v1.8 P9-A: 数据来源贡献度环形饼图(SVG 自实现)
 *
 * 设计动机:
 *   - 数据来源贡献度(contributions 字段)原本用横向进度条展示,
 *     信息密度低,看不出"哪个源占主导"
 *   - 环形饼图 + 中心总数 / 图例,一眼看出主导来源 + 整体规模
 *
 * 设计要点:
 *   - 纯 SVG 自实现,无外部依赖
 *   - 支持 0~8 个来源;过多时自动合并 <3% 的小源为"其他"
 *   - 颜色:固定调色板循环分配,保证视觉一致性
 *   - 中心文本:总数(条数)
 *   - 每个图例项:来源名 + 数量 + 百分比
 *   - 老报告(contributions 为空/缺失)时返回 null,交由父组件渲染原 UI
 *
 * 无障碍:
 *   - 用 role="img" + aria-label 概述图表
 *   - 每段用 <title> 提供 hover 文本
 */
import type { ReportContribution } from '../types';

interface Props {
  contributions: ReportContribution[];
  /** 中心文本:默认显示总条数 */
  centerLabel?: string;
  /** 外径,默认 140 */
  size?: number;
  /** 环宽,默认 22 */
  ringWidth?: number;
}

const PALETTE = [
  '#6366F1', // indigo
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#84CC16', // lime
];

const OTHER_THRESHOLD = 3; // 占比 < 3% 合并到"其他"

/**
 * 把 contributions 合并为带颜色的"扇形数据"。
 * 合并策略: 占比 < OTHER_THRESHOLD 的归入"其他"。
 */
function buildSegments(items: ReportContribution[]): Array<{
  label: string;
  count: number;
  percentage: number;
  color: string;
  isOther?: boolean;
}> {
  const sorted = [...items].sort((a, b) => b.percentage - a.percentage);
  type Segment = { label: string; count: number; percentage: number; color: string; isOther?: boolean };
  const main: Segment[] = [];
  let otherCount = 0;
  let otherPct = 0;
  sorted.forEach((c, i) => {
    if (c.percentage < OTHER_THRESHOLD && sorted.length > 4) {
      otherCount += c.count;
      otherPct += c.percentage;
    } else {
      main.push({
        label: c.source,
        count: c.count,
        percentage: c.percentage,
        color: PALETTE[i % PALETTE.length]!,
      });
    }
  });
  if (otherCount > 0) {
    main.push({
      label: '其他',
      count: otherCount,
      percentage: otherPct,
      color: PALETTE[main.length % PALETTE.length]!,
      isOther: true,
    });
  }
  return main;
}

export function SourceDonut({
  contributions,
  centerLabel,
  size = 140,
  ringWidth = 22,
}: Props) {
  // 老报告 / 空数据: 渲染 fallback 占位(让父组件可选择隐藏整块)
  if (!contributions || contributions.length === 0) return null;

  const segments = buildSegments(contributions);
  const total = segments.reduce((s, seg) => s + seg.count, 0);
  const center = size / 2;
  const r = (size - ringWidth) / 2;
  const circumference = 2 * Math.PI * r;

  // 用 stroke-dasharray 在一个圆上画各段:每段占 circumference 的 percentage%
  // 用 stroke-dashoffset 累计偏移;旋转 -90° 让第一段从顶部开始
  let offset = 0;
  const arcs = segments.map((seg, i) => {
    const len = (seg.percentage / 100) * circumference;
    const arc = (
      <circle
        key={`${seg.label}-${i}`}
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={seg.color}
        strokeWidth={ringWidth}
        strokeDasharray={`${len} ${circumference - len}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      >
        <title>
          {seg.label}: {seg.count} 条 ({seg.percentage.toFixed(1)}%)
        </title>
      </circle>
    );
    offset += len;
    return arc;
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative inline-flex items-center justify-center shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="数据来源贡献度环形饼图">
          {/* 底层轨道:深色边框让浅色段更清晰 */}
          <circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="rgba(148, 163, 184, 0.15)"
            strokeWidth={ringWidth}
          />
          {arcs}
        </svg>
        {/* 中心文本 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-text-primary tabular-nums">{total}</span>
          <span className="text-helper text-text-secondary">{centerLabel ?? '条来源'}</span>
        </div>
      </div>

      {/* 图例 */}
      <ul className="flex-1 min-w-0 space-y-1.5 w-full">
        {segments.map((seg, i) => (
          <li
            key={`legend-${seg.label}-${i}`}
            className="flex items-center gap-2 text-helper"
          >
            <span
              className="inline-block w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: seg.color }}
              aria-hidden
            />
            <span className="flex-1 min-w-0 truncate text-text-primary">
              {seg.label}
              {seg.isOther && (
                <span className="ml-1 text-text-tertiary text-label">(&lt;3% 已合并)</span>
              )}
            </span>
            <span className="tabular-nums text-text-secondary shrink-0">
              {seg.count} · {seg.percentage.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}