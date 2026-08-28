/**
 * 技术选型弹窗组件
 *
 * 功能:
 *   1. 触发 AI 生成 3 套技术栈方案
 *   2. 展示方案对比,用户选择一套
 *   3. 确认选择后回调父组件
 */
import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import type { TechOption, TechStackPlan, TechSelectionJob } from '../types';

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /** 用户确认选择某套方案后回调 */
  onConfirm: (plan: TechStackPlan) => void;
}

const POLL_INTERVAL = 3000;

const RISK_META = {
  low: { label: '低风险', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  medium: { label: '中风险', className: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  high: { label: '高风险', className: 'text-red-400 bg-red-500/10 border-red-500/20' },
} as const;

export function TechSelectionModal({ open, projectId, onClose, onConfirm }: Props) {
  const [job, setJob] = useState<TechSelectionJob | null>(null);
  const [selectedId, setSelectedId] = useState<'plan_a' | 'plan_b' | 'plan_c' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 打开时触发或恢复状态
  useEffect(() => {
    if (!open) {
      setJob(null);
      setSelectedId(null);
      setError(null);
      setConfirming(false);
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // 先尝试获取已有状态
    const init = async () => {
      try {
        const existing = await api.getTechSelectionStatus(projectId);
        if (existing.status === 'running') {
          setJob(existing);
          startPolling();
        } else if (existing.status === 'success' && existing.result) {
          setJob(existing);
          if (existing.selected_plan) {
            setSelectedId(existing.selected_plan);
          }
        } else {
          // 没有或失败,重新触发
          triggerGeneration();
        }
      } catch {
        // 404 等情况,触发新的
        triggerGeneration();
      }
    };
    void init();

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const startPolling = () => {
    if (timerRef.current !== null) return;
    const poll = async () => {
      try {
        const next = await api.getTechSelectionStatus(projectId);
        setJob(next);
        if (next.status !== 'running') {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (next.status === 'failed') {
            setError(next.error_message ?? '生成失败');
          }
        }
      } catch {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    };
    timerRef.current = window.setInterval(poll, POLL_INTERVAL);
  };

  const triggerGeneration = async () => {
    setError(null);
    try {
      const newJob = await api.triggerTechSelection(projectId);
      setJob(newJob);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    setConfirming(true);
    try {
      const res = await api.selectTechPlan(projectId, selectedId);
      onConfirm(res.selected_plan);
      onClose();
    } catch (err) {
      alert(`确认失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConfirming(false);
    }
  };

  if (!open) return null;

  const plans = job?.result?.plans ?? [];
  const recommended = job?.result?.recommended ?? null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card shadow-glass w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="p-6 border-b border-border">
          <h2 className="text-section text-text-primary">技术选型建议</h2>
          <p className="text-helper text-text-secondary mt-1">
            AI 基于项目描述、市场调研与产品形态评估,为你生成 3 套差异明确的技术栈方案,请选择最适合的一套
          </p>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 加载中 */}
          {job?.status === 'running' && (
            <div className="text-center py-12">
              <div className="text-body text-text-primary mb-2">{job.current_step}</div>
              <div className="text-helper text-text-secondary">
                正在评估项目约束与方案风险,请稍候…
              </div>
              <div className="mt-4 w-48 mx-auto bg-slate-700/50 rounded-full h-2 overflow-hidden">
                <div className="bg-gradient-to-r from-primary to-accent h-full animate-pulse" style={{ width: '60%' }} />
              </div>
            </div>
          )}

          {/* 错误 */}
          {error && (
            <div className="text-center py-8">
              <div className="text-red-400 mb-4">技术选型分析失败:{error}</div>
              <button
                onClick={triggerGeneration}
                className="text-primary hover:underline text-[15px]"
              >
                重新生成
              </button>
            </div>
          )}

          {/* AI 推荐依据与关键假设 */}
          {job?.status === 'success' && job.result && (
            <div className="mb-4 rounded-card border border-primary/20 bg-primary/5 p-4">
              <div className="text-[15px] font-medium text-text-primary mb-2">AI 推荐依据</div>
              <p className="text-[13px] text-text-secondary leading-relaxed">
                {job.result.recommendation_reason}
              </p>
              <div className="mt-3 pt-3 border-t border-primary/10">
                <div className="text-[12px] font-medium text-text-secondary mb-1.5">关键假设</div>
                <ul className="space-y-1 text-[12px] text-text-secondary">
                  {job.result.key_assumptions.map((assumption) => (
                    <li key={assumption}>• {assumption}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 方案列表 */}
          {job?.status === 'success' && plans.length > 0 && (
            <div className="space-y-4">
              {plans.map((plan) => (
                <div
                  key={plan.plan_id}
                  onClick={() => setSelectedId(plan.plan_id)}
                  className={`border rounded-card p-5 cursor-pointer transition-all ${
                    selectedId === plan.plan_id
                      ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                      : 'border-border hover:border-primary/50 bg-card-solid/20'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-[17px] font-semibold text-text-primary">
                          {plan.plan_name}
                        </h3>
                        {recommended === plan.plan_id && (
                          <span className="text-[12px] bg-gradient-to-r from-primary to-accent text-white px-2 py-0.5 rounded">
                            AI 推荐
                          </span>
                        )}
                      </div>
                      <p className="text-helper text-text-secondary mt-1">{plan.tagline}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
                          项目适配度 {plan.fit_score}/5
                        </span>
                        <span
                          className={`text-[11px] border px-2 py-0.5 rounded ${RISK_META[plan.risk_level].className}`}
                        >
                          {RISK_META[plan.risk_level].label}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-helper text-text-secondary">预估工期</div>
                      <div className="text-[15px] font-medium text-text-primary">
                        ~{plan.estimated_weeks} 人周
                      </div>
                    </div>
                  </div>

                  <p className="text-[14px] text-text-secondary mb-4">
                    <span className="font-medium">适用场景:</span> {plan.suitable_for}
                  </p>

                  <div className="bg-card-solid/30 border border-border rounded-lg p-3 mb-4">
                    <div className="text-[12px] text-text-secondary mb-1">整体架构</div>
                    <div className="text-[13px] text-text-primary leading-relaxed">
                      {plan.architecture}
                    </div>
                  </div>

                  {/* 技术选型表格 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <TechItem label="前端" items={Object.entries(plan.frontend)} />
                    <TechItem label="后端" items={Object.entries(plan.backend)} />
                    <TechItem label="数据库" items={Object.entries(plan.database)} />
                    <TechItem label="部署" items={Object.entries(plan.deployment)} />
                  </div>

                  {plan.third_party.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[12px] text-text-secondary mb-2">第三方服务</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {plan.third_party.map((item) => (
                          <div
                            key={item.name}
                            className="bg-card-solid/50 border border-border rounded-lg p-3 backdrop-blur-sm"
                          >
                            <div className="text-[11px] text-primary mb-1">{item.category}</div>
                            <div className="text-[14px] font-medium text-text-primary">{item.name}</div>
                            <p className="mt-1 text-[12px] text-text-secondary leading-relaxed">
                              {item.reason}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 优缺点 */}
                  <div className="grid grid-cols-2 gap-4 text-[13px]">
                    <div>
                      <div className="text-emerald-400 font-medium mb-1">优势</div>
                      <ul className="space-y-0.5">
                        {plan.pros.map((p, i) => (
                          <li key={i} className="text-text-secondary">
                            ✓ {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-amber-400 font-medium mb-1">风险/劣势</div>
                      <ul className="space-y-0.5">
                        {plan.cons.map((c, i) => (
                          <li key={i} className="text-text-secondary">
                            ⚠ {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="p-6 border-t border-border flex justify-between items-center">
          <button
            onClick={onClose}
            className="h-10 px-4 text-[15px] text-text-secondary hover:text-text-primary transition-colors"
          >
            暂不选择
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId || confirming || job?.status !== 'success'}
            className="h-10 px-6 text-[15px] font-medium rounded-lg bg-gradient-to-r from-primary to-primary-dark text-white hover:from-primary-light hover:to-primary transition-all shadow-glow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirming ? '确认中...' : selectedId ? '确认选择此方案' : '请选择一套方案'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 单个技术分类下的组件组合 */
function TechItem({
  label,
  items,
}: {
  label: string;
  items: [string, TechOption][];
}) {
  const maturityLabel: Record<string, string> = {
    mature: '成熟',
    growing: '成长',
    emerging: '前沿',
  };
  const componentLabel: Record<string, string> = {
    framework: '框架',
    language: '语言',
    ui: 'UI',
    state_management: '状态管理',
    build_tool: '构建工具',
    auth: '鉴权',
    middleware: '中间件',
    primary: '主数据库',
    cache: '缓存',
    search: '搜索',
    container: '容器化',
    ci_cd: 'CI/CD',
    hosting: '托管',
  };

  return (
    <div className="bg-card-solid/50 border border-border rounded-lg p-3 backdrop-blur-sm">
      <div className="text-[12px] text-text-secondary mb-2">{label}</div>
      <div className="space-y-3">
        {items.map(([key, tech]) => (
          <div key={key}>
            <div className="text-[11px] text-text-tertiary mb-0.5">
              {componentLabel[key] ?? key}
            </div>
            <div className="text-[14px] font-medium text-text-primary">{tech.name}</div>
            <p className="mt-1 text-[12px] text-text-secondary leading-relaxed">{tech.reason}</p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-text-secondary">
              <span>{maturityLabel[tech.maturity] ?? tech.maturity}</span>
              <span>·</span>
              <span>⭐ {tech.community_score}/5</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
