/**
 * 报告对比视图 (v1.8 P5-A)
 *
 * 通过 URL query `?ids=<id1>,<id2>,...` 接收待对比的项目 ID 列表,
 * 从后端并发拉取所有项目的完整报告数据,渲染并排对比表格与维度柱状图。
 *
 * 适用场景:
 *   - 同一行业 / 细分赛道的多份报告,横向对比市场热度、竞品密度、痛点数
 *   - 同一项目不同时期的复盘(同名前后调研)
 *   - 给投资人 / 团队 review 多份市场分析
 *
 * 设计要点:
 *   - 维度统一表格 + 视觉化:左列"维度",右列"项目 1 / 项目 2 / 项目 3"列
 *   - 数字维度用相对宽度条形图(横向条),一眼看差异
 *   - 文字维度截断 200 字 + 「展开」按钮
 *   - 状态维度颜色化(rising=绿 / stable=黄 / declining=红)
 */
import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Card } from '../components/Card';
import { Banner } from '../components/Banner';
import { Container } from '../components/Container';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import type { Project, MarketReport } from '../types';

/** 单个对比项:项目 + 报告(可能为空,表示调研尚未完成) */
interface CompareItem {
  id: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
  report: MarketReport | null;
}

/** 对比维度定义 */
type DimensionKey =
  | 'name'
  | 'description'
  | 'status'
  | 'created'
  | 'heat_score'
  | 'trend'
  | 'search_volume'
  | 'discussion_count'
  | 'competitor_count'
  | 'pain_count'
  | 'risk_count'
  | 'opportunity_count'
  | 'source_count'
  | 'summary';

interface DimensionDef {
  key: DimensionKey;
  label: string;
  /** 该维度上"高 = 好 / 低 = 好"语义,用于柱状条着色 */
  direction?: 'higher_better' | 'lower_better' | 'neutral';
  /** 是否数字维度(用于柱状条可视化) */
  numeric?: boolean;
}

/** 13 个对比维度 */
const DIMENSIONS: DimensionDef[] = [
  { key: 'name', label: '项目名' },
  { key: 'description', label: '描述' },
  { key: 'status', label: '状态' },
  { key: 'created', label: '创建时间' },
  { key: 'heat_score', label: '市场热度评分', numeric: true, direction: 'higher_better' },
  { key: 'trend', label: '趋势' },
  { key: 'search_volume', label: '月搜索量', numeric: true, direction: 'higher_better' },
  { key: 'discussion_count', label: '社区讨论数', numeric: true, direction: 'higher_better' },
  { key: 'competitor_count', label: '竞品数量', numeric: true, direction: 'lower_better' },
  { key: 'pain_count', label: '用户痛点数', numeric: true, direction: 'higher_better' },
  { key: 'risk_count', label: '风险数', numeric: true, direction: 'lower_better' },
  { key: 'opportunity_count', label: '机会数', numeric: true, direction: 'higher_better' },
  { key: 'source_count', label: '数据来源数', numeric: true, direction: 'higher_better' },
  { key: 'summary', label: '执行摘要' },
];

/** 从项目 + 报告对象中抽取单个维度的值(字符串,渲染时按类型适配) */
function readDimension(item: CompareItem, key: DimensionKey): string {
  const { report } = item;
  switch (key) {
    case 'name': return item.name;
    case 'description': return item.description;
    case 'status': return item.status;
    case 'created': return new Date(item.created_at).toLocaleString('zh-CN', { hour12: false });
    case 'heat_score': return report ? String(report.market_heat.heat_score) : '—';
    case 'trend': return report ? report.market_heat.trend : '—';
    case 'search_volume': return report ? report.market_heat.search_volume.toLocaleString() : '—';
    case 'discussion_count': return report ? String(report.market_heat.discussion_count) : '—';
    case 'competitor_count': return report ? String(report.competitors.length) : '—';
    case 'pain_count': return report ? String(report.pain_points.length) : '—';
    case 'risk_count': return report ? String(report.risks.length) : '—';
    case 'opportunity_count': return report ? String(report.opportunities.length) : '—';
    case 'source_count': return report ? String(report.sources.length) : '—';
    case 'summary': return report ? report.summary : '—';
  }
}

/** 数字维度字符串解析为数字(失败返回 0) */
function parseNumeric(s: string): number {
  if (s === '—' || !s) return 0;
  // 去掉千分位逗号
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 趋势文案本地化 */
const TREND_LABEL: Record<string, string> = {
  rising: '📈 上升',
  stable: '➡️ 平稳',
  declining: '📉 下降',
};

/** 状态文案本地化 */
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  analyzing: '调研中',
  completed: '已完成',
  failed: '失败',
};

export function Compare() {
  const [params, setParams] = useSearchParams();
  const idsParam = params.get('ids') ?? '';
  const ids = useMemo(
    () =>
      idsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4), // 最多对比 4 份
    [idsParam],
  );

  const [items, setItems] = useState<CompareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 进入页面时并发拉取所有项目的报告数据
  useEffect(() => {
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const results = await Promise.allSettled(
          ids.map((id) => api.getProject(id) as Promise<Project & { report: MarketReport | null }>),
        );
        if (cancelled) return;
        const ok: CompareItem[] = [];
        for (let i = 0; i < ids.length; i++) {
          const r = results[i];
          if (r && r.status === 'fulfilled') {
            const p = r.value;
            ok.push({
              id: p.id,
              name: p.name,
              description: p.description,
              status: p.status,
              created_at: p.created_at,
              report: p.report ?? null,
            });
          } else if (r && r.status === 'rejected') {
            // 单条失败:仍渲染一行,提示错误
            ok.push({
              id: ids[i]!,
              name: `加载失败 (${ids[i]!.slice(0, 8)}...)`,
              description: r.reason instanceof Error ? r.reason.message : String(r.reason),
              status: 'failed',
              created_at: new Date().toISOString(),
              report: null,
            });
          }
        }
        setItems(ok);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // 数值维度用于柱状条,需要取所有项目的最大值归一化
  const numericMax = useMemo(() => {
    const result: Partial<Record<DimensionKey, number>> = {};
    for (const dim of DIMENSIONS) {
      if (!dim.numeric) continue;
      let max = 0;
      for (const item of items) {
        const n = parseNumeric(readDimension(item, dim.key));
        if (n > max) max = n;
      }
      result[dim.key] = max;
    }
    return result;
  }, [items]);

  const removeId = (id: string) => {
    const next = ids.filter((x) => x !== id);
    if (next.length === 0) {
      setParams({});
    } else {
      setParams({ ids: next.join(',') });
    }
  };

  return (
    <Container size="xl">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-title text-text-primary">报告对比</h1>
          <p className="text-helper text-text-secondary mt-1">
            选中 2-4 份已完成报告,横向对比市场热度、竞品密度与风险机会
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/history"
            className="text-helper text-text-secondary hover:text-primary transition-colors"
          >
            ← 返回历史
          </Link>
          <Button
            onClick={() => setParams({})}
            disabled={ids.length === 0}
            title="清空对比列表"
          >
            清空
          </Button>
        </div>
      </div>

      {/* 空状态 */}
      {ids.length === 0 && (
        <Banner tone="info" title="尚未选择对比项目">
          请前往「历史记录」页,勾选 2-4 份「已完成」项目后,点击「📊 对比选中」按钮。
        </Banner>
      )}

      {/* 单选错误 */}
      {ids.length === 1 && (
        <Banner tone="warning" title="至少选择 2 份报告">
          当前仅选了 1 份。请回到历史页再勾选 1 份进入对比,或「清空」当前选择。
        </Banner>
      )}

      {/* 加载 / 错误 */}
      {loading && (
        <Card>
          <div className="text-text-secondary py-8 text-center">正在加载 {ids.length} 份报告...</div>
        </Card>
      )}
      {error && (
        <Banner tone="error" title="加载失败">
          {error}
        </Banner>
      )}

      {/* 主对比表 */}
      {!loading && items.length >= 2 && (
        <>
          {/* 顶部项目卡片(横向铺开) */}
          <div className={`grid gap-4 mb-6 ${
            items.length === 2 ? 'grid-cols-1 md:grid-cols-2' :
            items.length === 3 ? 'grid-cols-1 md:grid-cols-3' :
            'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
          }`}>
            {items.map((item) => (
              <Card key={item.id}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-body font-medium text-text-primary truncate flex-1" title={item.name}>
                    {item.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeId(item.id)}
                    aria-label={`从对比中移除 ${item.name}`}
                    className="text-text-tertiary hover:text-error text-helper shrink-0"
                    title="移除"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-helper text-text-secondary line-clamp-2 mb-2">
                  {item.description}
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <StatusBadge kind={
                    item.status === 'completed' ? 'success' :
                    item.status === 'analyzing' ? 'analyzing' :
                    item.status === 'failed' ? 'failed' : 'idle'
                  } />
                  <span className="text-helper text-text-secondary">
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/report/${item.id}`}
                    className="text-helper text-primary hover:underline"
                  >
                    查看完整报告 →
                  </Link>
                </div>
              </Card>
            ))}
          </div>

          {/* 维度对比表 */}
          <Card title="维度对比">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-helper text-text-secondary font-medium w-32">
                      维度
                    </th>
                    {items.map((item) => (
                      <th
                        key={item.id}
                        className="text-left p-3 text-helper text-text-secondary font-medium min-w-[180px]"
                      >
                        {item.name.length > 14
                          ? `${item.name.slice(0, 14)}…`
                          : item.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((dim) => {
                    // 计算该行的所有值,用于柱状条
                    const values = items.map((item) => readDimension(item, dim.key));
                    const maxVal = dim.numeric ? numericMax[dim.key] ?? 0 : 0;
                    return (
                      <tr key={dim.key} className="border-b border-border/40 hover:bg-hover-bg/30">
                        <td className="p-3 text-helper text-text-secondary align-top">
                          {dim.label}
                        </td>
                        {items.map((item, idx) => {
                          const val = values[idx]!;
                          const num = dim.numeric ? parseNumeric(val) : 0;
                          const pct = dim.numeric && maxVal > 0
                            ? Math.round((num / maxVal) * 100)
                            : 0;
                          // 着色:higher_better → 绿越高越好;lower_better → 红越高越差
                          const tone =
                            dim.direction === 'lower_better'
                              ? '#F87171' // 偏红
                              : dim.direction === 'higher_better'
                                ? '#34D399' // 偏绿
                                : '#60A5FA'; // 中性蓝
                          return (
                            <td key={item.id} className="p-3 align-top">
                              {dim.numeric ? (
                                <div>
                                  <div className="text-body text-text-primary font-medium mb-1.5">
                                    {val === '—' ? <span className="text-text-tertiary">—</span> : val}
                                  </div>
                                  {val !== '—' && maxVal > 0 && (
                                    <div className="h-1.5 bg-slate-700/40 rounded-full overflow-hidden" role="presentation">
                                      <div
                                        className="h-full transition-all duration-300"
                                        style={{
                                          width: `${pct}%`,
                                          backgroundColor: tone,
                                        }}
                                        aria-hidden
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : dim.key === 'trend' ? (
                                <span className="text-body text-text-primary">
                                  {val === '—' ? <span className="text-text-tertiary">—</span> : TREND_LABEL[val] ?? val}
                                </span>
                              ) : dim.key === 'summary' || dim.key === 'description' ? (
                                <p className="text-helper text-text-secondary line-clamp-3" title={val}>
                                  {val}
                                </p>
                              ) : dim.key === 'status' ? (
                                <span className="text-body text-text-primary">
                                  {STATUS_LABEL[val] ?? val}
                                </span>
                              ) : (
                                <span className="text-body text-text-primary">{val}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 维度图例说明 */}
          <div className="mt-4 text-helper text-text-secondary flex flex-wrap gap-x-5 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: '#34D399' }} />
              越高越好
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: '#F87171' }} />
              越低越好
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: '#60A5FA' }} />
              中性参考
            </span>
          </div>
        </>
      )}
    </Container>
  );
}
