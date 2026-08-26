/**
 * 前端设计方案弹窗组件
 *
 * 功能:
 *   1. 触发 AI 生成 2-3 套前端设计方案
 *   2. 展示设计风格、交互模式、响应式策略等对比
 *   3. 用户选择一套后确认
 */
import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import type { FrontendDesignPlan, FrontendDesignJob } from '../types';

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onConfirm: (plan: FrontendDesignPlan) => void;
}

const POLL_INTERVAL = 3000;

export function FrontendDesignModal({ open, projectId, onClose, onConfirm }: Props) {
  const [job, setJob] = useState<FrontendDesignJob | null>(null);
  const [selectedId, setSelectedId] = useState<'plan_a' | 'plan_b' | 'plan_c' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<number | null>(null);

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

    const init = async () => {
      try {
        const existing = await api.getFrontendDesignStatus(projectId);
        if (existing.status === 'running') {
          setJob(existing);
          startPolling();
        } else if (existing.status === 'success' && existing.result) {
          setJob(existing);
          if (existing.selected_plan) {
            setSelectedId(existing.selected_plan);
          }
        } else {
          triggerGeneration();
        }
      } catch {
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
        const next = await api.getFrontendDesignStatus(projectId);
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
      const newJob = await api.triggerFrontendDesign(projectId);
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
      const res = await api.selectFrontendDesignPlan(projectId, selectedId);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card shadow-glass w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-border">
          <h2 className="text-section text-text-primary">前端设计方案</h2>
          <p className="text-helper text-text-secondary mt-1">
            AI 基于产品场景和用户画像,为你推荐多套前端设计方案,请选择最适合的一套
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* 加载中 */}
          {job?.status === 'running' && (
            <div className="text-center py-12">
              <div className="text-body text-text-primary mb-2">{job.current_step}</div>
              <div className="text-helper text-text-secondary">
                正在分析用户画像与产品场景...
              </div>
              <div className="mt-4 w-48 mx-auto bg-slate-700/50 rounded-full h-2 overflow-hidden">
                <div className="bg-gradient-to-r from-primary to-accent h-full animate-pulse" style={{ width: '50%' }} />
              </div>
            </div>
          )}

          {/* 错误 */}
          {error && (
            <div className="text-center py-8">
              <div className="text-red-400 mb-4">前端设计方案生成失败:{error}</div>
              <button
                onClick={triggerGeneration}
                className="text-primary hover:underline text-[15px]"
              >
                重新生成
              </button>
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
                    </div>
                  </div>

                  <p className="text-[14px] text-text-secondary mb-4">
                    <span className="font-medium">适用场景:</span> {plan.suitable_for}
                  </p>

                  {/* 设计风格关键词 */}
                  <div className="mb-4">
                    <div className="text-[12px] text-text-secondary mb-2">设计风格</div>
                    <div className="flex flex-wrap gap-2">
                      {plan.design_style.keywords.map((kw, i) => (
                        <span
                          key={i}
                          className="text-[13px] px-3 py-1 bg-card-solid/50 text-text-primary rounded-full border border-border"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 配色方案 */}
                  <div className="mb-4">
                    <div className="text-[12px] text-text-secondary mb-2">配色方案</div>
                    <div className="flex gap-3 items-center">
                      <ColorSwatch label="主色" desc={plan.design_style.color_palette.primary} />
                      <ColorSwatch label="辅色" desc={plan.design_style.color_palette.secondary} />
                      <ColorSwatch label="中性" desc={plan.design_style.color_palette.neutral} />
                      {plan.design_style.color_palette.accent && (
                        <ColorSwatch label="点缀" desc={plan.design_style.color_palette.accent} />
                      )}
                    </div>
                  </div>

                  {/* 交互 + 响应式 + UI库 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    <InfoBlock label="交互模式" text={plan.interaction_pattern.navigation} />
                    <InfoBlock
                      label="响应式策略"
                      text={
                        plan.responsive_strategy.priority === 'mobile-first'
                          ? '移动优先'
                          : plan.responsive_strategy.priority === 'desktop-first'
                            ? '桌面优先'
                            : '双端并重'
                      }
                    />
                    <InfoBlock label="推荐 UI 库" text={plan.ui_library.name} />
                  </div>

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
                      <div className="text-amber-400 font-medium mb-1">注意事项</div>
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

/** 色块展示 */
function ColorSwatch({ label, desc }: { label: string; desc: string }) {
  // 尝试从描述中提取十六进制颜色,找不到就用灰色占位
  const hexMatch = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/.exec(desc);
  const color = hexMatch ? hexMatch[0] : '#e5e7eb';
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-8 h-8 rounded border border-border"
        style={{ backgroundColor: color }}
        title={desc}
      />
      <div>
        <div className="text-[11px] text-text-secondary">{label}</div>
        <div className="text-[12px] text-text-primary">{desc}</div>
      </div>
    </div>
  );
}

/** 信息块 */
function InfoBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="bg-card-solid/50 border border-border rounded-lg p-3 backdrop-blur-sm">
      <div className="text-[12px] text-text-secondary mb-1">{label}</div>
      <div className="text-[13px] text-text-primary">{text}</div>
    </div>
  );
}
