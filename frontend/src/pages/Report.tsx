/**
 * 报告页 - 按前端设计文档 §3.2
 * 卡片分组:执行摘要 / 热度数字 / 竞品 / 痛点 / 风险机会 / 数据来源
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { LlmSetupPrompt } from '../components/LlmSetupPrompt';
import { api } from '../lib/api';
import { useResearch } from '../hooks/useResearch';
import type { MarketReport, Project } from '../types';

export function Report() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { status, report, loading, error, errorCode, trigger, reset } = useResearch();

  useEffect(() => {
    if (!id) return;
    reset();
    (async () => {
      try {
        const p = await api.getProject(id);
        setProject(p);
        if (p.report) {
          // 已有报告,直接展示
        } else if (p.status !== 'analyzing') {
          // 启动调研
          await trigger(p.id);
        } else {
          // 正在调研,继续轮询
          await trigger(p.id);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loadError) {
    return (
      <main className="flex-1 px-6 py-10 max-w-3xl mx-auto">
        <Card>
          <div className="text-red-600">加载失败:{loadError}</div>
          <div className="mt-4">
            <Button variant="text" onClick={() => navigate('/')}>
              ← 返回首页
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  const isCompleted = report !== null;
  const isAnalyzing = loading && !report;
  const currentReport: MarketReport | null = report ?? project?.report ?? null;

  return (
    <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="text" onClick={() => navigate('/')}>
          ← 返回首页
        </Button>
        {project && (
          <div className="flex items-center gap-2">
            <span className="text-helper text-text-secondary">{project.name}</span>
            <StatusBadge kind={statusKind(project.status)} />
          </div>
        )}
      </div>

      {isAnalyzing && (
        <Card title="分析中...">
          <div className="text-text-secondary text-helper">
            {status?.progress ?? '准备中...'}
          </div>
          <div className="mt-3 inline-flex items-center gap-1">
            <span className="dot-1">.</span>
            <span className="dot-2">.</span>
            <span className="dot-3">.</span>
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <div className="text-red-600">调研失败:{error}</div>
        </Card>
      )}

      {currentReport && (
        <>
          <Card title="执行摘要">
            <p className="text-body text-text-primary leading-relaxed">
              {currentReport.summary}
            </p>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
            <Card title="搜索热度">
              <div className="text-[32px] font-semibold text-text-primary">
                {currentReport.market_heat.search_volume.toLocaleString()}
              </div>
              <div className="text-helper text-text-secondary mt-1">
                趋势:
                {currentReport.market_heat.trend === 'rising'
                  ? '↑ 上升'
                  : currentReport.market_heat.trend === 'declining'
                  ? '↓ 下降'
                  : '→ 平稳'}
              </div>
            </Card>
            <Card title="讨论量">
              <div className="text-[32px] font-semibold text-text-primary">
                {currentReport.market_heat.discussion_count.toLocaleString()}
              </div>
              <div className="text-helper text-text-secondary mt-1">
                来自论坛与社区
              </div>
            </Card>
            <Card title="热度评分">
              <div className="text-[32px] font-semibold text-text-primary">
                {currentReport.market_heat.heat_score}
                <span className="text-base text-text-secondary">/100</span>
              </div>
              <div className="text-helper text-text-secondary mt-1">
                综合量化
              </div>
            </Card>
          </div>

          <Card title="竞品识别">
            {currentReport.competitors.length === 0 ? (
              <div className="text-helper text-text-secondary">暂无数据</div>
            ) : (
              <ul className="space-y-3">
                {currentReport.competitors.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-text-secondary mt-2">·</span>
                    <div>
                      <div className="font-medium">
                        {c.name}
                        {c.url && (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 text-primary text-helper hover:underline"
                          >
                            链接
                          </a>
                        )}
                      </div>
                      <div className="text-helper text-text-secondary mt-0.5">
                        {c.description}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="my-6">
            <Card title="用户痛点">
              {currentReport.pain_points.length === 0 ? (
                <div className="text-helper text-text-secondary">暂无数据</div>
              ) : (
                <ul className="space-y-2">
                  {currentReport.pain_points.map((p, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-text-secondary mt-2">·</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="市场规模估算">
            <p className="text-body">{currentReport.market_size}</p>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6">
            <Card title="风险">
              {currentReport.risks.length === 0 ? (
                <div className="text-helper text-text-secondary">暂无数据</div>
              ) : (
                <ul className="space-y-2">
                  {currentReport.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-text-secondary mt-2">·</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="机会">
              {currentReport.opportunities.length === 0 ? (
                <div className="text-helper text-text-secondary">暂无数据</div>
              ) : (
                <ul className="space-y-2">
                  {currentReport.opportunities.map((o, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-text-secondary mt-2">·</span>
                      <span>{o}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="数据来源">
            {currentReport.sources.length === 0 ? (
              <div className="text-helper text-text-secondary">暂无来源</div>
            ) : (
              <ul className="space-y-2">
                {currentReport.sources.map((s, i) => (
                  <li key={i} className="text-body">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline break-all"
                    >
                      [{i + 1}] {s.title}
                    </a>
                    {s.source && (
                      <span className="ml-2 text-helper text-text-secondary">
                        ({s.source})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="mt-8 flex justify-center">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const r = await api.generateLanding(id!);
                  alert(r.message ?? '功能开发中');
                } catch (err) {
                  alert(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              生成验证页
            </Button>
          </div>
        </>
      )}

      {!isAnalyzing && !currentReport && !loadError && (
        <Card>
          <div className="text-text-secondary">该调研尚未开始或已完成但未生成报告</div>
          <div className="mt-4 flex gap-2">
            <Link
              to="/"
              className="text-primary hover:underline text-[15px]"
            >
              ← 返回首页
            </Link>
          </div>
        </Card>
      )}

      <LlmSetupPrompt
        open={!loading && errorCode === 'MISSING_API_KEY'}
        errorCode={errorCode}
        onClose={() => {
          reset();
        }}
        onGoSettings={() => navigate('/settings')}
      />
    </main>
  );
}

function statusKind(s: string): 'success' | 'warning' | 'failed' | 'analyzing' | 'idle' {
  if (s === 'completed') return 'success';
  if (s === 'failed') return 'failed';
  if (s === 'analyzing') return 'analyzing';
  if (s === 'draft') return 'idle';
  return 'warning';
}