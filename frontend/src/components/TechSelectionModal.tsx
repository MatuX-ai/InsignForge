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
import type { TechStackPlan, TechSelectionJob } from '../types';

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /** 用户确认选择某套方案后回调 */
  onConfirm: (plan: TechStackPlan) => void;
}

const POLL_INTERVAL = 3000;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card shadow-glass w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="p-6 border-b border-border">
          <h2 className="text-section text-text-primary">技术选型建议</h2>
          <p className="text-helper text-text-secondary mt-1">
            AI 基于项目需求和最新开源技术生态,为你推荐 3 套技术栈方案,请选择最适合的一套
          </p>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 加载中 */}
          {job?.status === 'running' && (
            <div className="text-center py-12">
              <div className="text-body text-text-primary mb-2">{job.current_step}</div>
              <div className="text-helper text-text-secondary">
                正在搜索最新开源技术,评估方案中...
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

                  {/* 技术选型表格 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <TechItem label="前端" tech={plan.frontend} />
                    <TechItem label="后端" tech={plan.backend} />
                    <TechItem label="数据库" tech={plan.database} />
                    <TechItem label="部署" tech={plan.deployment} />
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

/** 单个技术选型项 */
function TechItem({ label, tech }: { label: string; tech: { name: string; maturity: string; community_score: number } }) {
  const maturityLabel: Record<string, string> = {
    mature: '成熟',
    growing: '成长',
    emerging: '前沿',
  };
  return (
    <div className="bg-card-solid/50 border border-border rounded-lg p-3 backdrop-blur-sm">
      <div className="text-[12px] text-text-secondary mb-1">{label}</div>
      <div className="text-[14px] font-medium text-text-primary">{tech.name}</div>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-text-secondary">
        <span>{maturityLabel[tech.maturity] ?? tech.maturity}</span>
        <span>·</span>
        <span>⭐ {tech.community_score}/5</span>
      </div>
    </div>
  );
}
