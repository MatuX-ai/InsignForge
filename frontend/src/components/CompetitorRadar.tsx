/**
 * v1.8 P9-A: 竞品多维度雷达图(SVG 自实现)
 *
 * 设计动机:
 *   - 竞品对比矩阵用表格展示,信息密度高但视觉不直观
 *   - 雷达图把"多个竞品 × 多维度评分"画在一个图里,一眼看出"谁更均衡 / 谁有偏科"
 *
 * 维度定义(基于 ReportCompetitor 的结构化字段推断,0~100 分):
 *   1. **优势密度**   = min(100, strengths.length × 25)   // 4 条优势即满分
 *   2. **数据透明度** = min(100, weaknesses.length × 25)  // 敢于写不足 = 信息透明
 *   3. **描述完整度** = min(100, description.length × 2)  // 50 字以上即满分
 *   4. **官网可达**   = url 存在 ? 100 : 0
 *   5. **数据丰富度** = (优势密度 + 数据透明度 + 描述完整度) / 3
 *
 * 实现要点:
 *   - 纯 SVG 自实现,无外部依赖
 *   - 固定 5 个维度(根据竞品字段自然推导,避免凭空捏造)
 *   - 最多展示前 5 个竞品(过多会糊在一起);过多时折叠为"+N"
 *   - 透明 fill + 实线 stroke,避免遮挡
 *
 * 注意事项:
 *   - 这是"基于报告数据结构的相对评分",不是 LLM 真实评价,
 *     在组件底部加 disclaimer,避免误用
 *   - 老报告/单竞品时降级: < 2 个竞品返回 null(雷达图无意义)
 */
import { useMemo } from 'react';
import type { ReportCompetitor } from '../types';

interface Props {
  competitors: ReportCompetitor[];
  /** SVG 尺寸,默认 360 */
  size?: number;
}

const AXES = [
  { key: 'strengths', label: '优势密度' },
  { key: 'weaknesses', label: '数据透明' },
  { key: 'description', label: '描述完整' },
  { key: 'url', label: '官网可达' },
  { key: 'richness', label: '数据丰富' },
] as const;

const PALETTE = [
  '#6366F1', // indigo
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
];

/** 把单个竞品的字段映射到 5 个维度的 0~100 数值 */
function scoreCompetitor(c: ReportCompetitor): number[] {
  const strengths = Math.min(100, (c.strengths?.length ?? 0) * 25);
  const weaknesses = Math.min(100, (c.weaknesses?.length ?? 0) * 25);
  const description = Math.min(100, (c.description?.length ?? 0) * 2);
  const url = c.url ? 100 : 0;
  const richness = Math.round((strengths + weaknesses + description) / 3);
  return [strengths, weaknesses, description, url, richness];
}

export function CompetitorRadar({ competitors, size = 360 }: Props) {
  // 雷达图需要 ≥ 2 个竞品才有比较意义
  const list = useMemo(() => competitors.slice(0, 5), [competitors]);
  if (list.length < 2) return null;

  const cx = size / 2;
  const cy = size / 2;
  // 内圈半径留出标签空间
  const r = size * 0.32;
  const labelOffset = size * 0.42;

  // 每个轴端点的角度 (从顶部 12 点开始,顺时针)
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;

  // 网格同心多边形 (5 圈)
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  const gridPolys = gridLevels.map((lv) => {
    const pts = AXES.map((_, i) => {
      const a = angle(i);
      return `${cx + Math.cos(a) * r * lv},${cy + Math.sin(a) * r * lv}`;
    }).join(' ');
    return <polygon key={`g-${lv}`} points={pts} fill="none" stroke="rgba(148, 163, 184, 0.18)" strokeWidth={1} />;
  });

  // 每个轴的辐射线
  const axisLines = AXES.map((_, i) => {
    const a = angle(i);
    return (
      <line
        key={`axis-${i}`}
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(a) * r}
        y2={cy + Math.sin(a) * r}
        stroke="rgba(148, 163, 184, 0.15)"
        strokeWidth={1}
      />
    );
  });

  // 每个轴的标签(放在轴线外侧)
  const axisLabels = AXES.map((ax, i) => {
    const a = angle(i);
    const x = cx + Math.cos(a) * labelOffset;
    const y = cy + Math.sin(a) * labelOffset;
    return (
      <text
        key={`lbl-${ax.key}`}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="text-helper fill-text-secondary"
        fontSize="11"
      >
        {ax.label}
      </text>
    );
  });

  // 每个竞品的多边形 + 数据点
  const shapes = list.map((c, idx) => {
    const scores = scoreCompetitor(c);
    const pts = scores.map((s, i) => {
      const a = angle(i);
      return `${cx + Math.cos(a) * r * (s / 100)},${cy + Math.sin(a) * r * (s / 100)}`;
    }).join(' ');
    const color = PALETTE[idx % PALETTE.length]!;
    return (
      <g key={`comp-${idx}-${c.name}`}>
        <polygon
          points={pts}
          fill={color}
          fillOpacity={0.15}
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          style={{ transition: 'all 0.4s ease' }}
        >
          <title>{c.name}</title>
        </polygon>
        {scores.map((s, i) => {
          const a = angle(i);
          const px = cx + Math.cos(a) * r * (s / 100);
          const py = cy + Math.sin(a) * r * (s / 100);
          return (
            <circle key={`dot-${i}`} cx={px} cy={py} r={3} fill={color}>
              <title>{AXES[i]!.label}: {s}</title>
            </circle>
          );
        })}
      </g>
    );
  });

  // 多余竞品的折叠提示
  const overflow = competitors.length - list.length;

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${competitors.length} 个竞品的多维度雷达对比`}
      >
        {gridPolys}
        {axisLines}
        {shapes}
        {axisLabels}
      </svg>

      {/* 图例 */}
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-2">
        {list.map((c, i) => (
          <li key={`legend-${i}`} className="flex items-center gap-1.5 text-helper">
            <span
              className="inline-block w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              aria-hidden
            />
            <span className="text-text-primary">{c.name}</span>
          </li>
        ))}
        {overflow > 0 && (
          <li className="text-text-tertiary text-label">+{overflow} 个未显示</li>
        )}
      </ul>
      <p className="text-label text-text-tertiary mt-2 text-center">
        基于报告结构化字段推导的相对评分,仅供参考
      </p>
    </div>
  );
}