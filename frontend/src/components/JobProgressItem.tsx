/**
 * JobProgressItem - 任务进度单项
 * 统一渲染"进行中 / 已完成 / 失败"三种状态
 *
 * 状态行为:
 *   running: 进度条 + 阶段文字 + 已耗时 + 剩余时间估算
 *   success: 单行摘要 + 主要操作按钮 (例如"下载")
 *   failed : 单行摘要 + 重试按钮
 *   idle   : 不渲染
 */
import { ResearchProgress } from './ResearchProgress';
import { useEffect, useState } from 'react';

export type JobStatus = 'idle' | 'running' | 'success' | 'failed';

export interface JobProgressInfo {
  /** 任务名,如"开发文档" / "商业计划书" */
  label: string;
  status: JobStatus;
  /** 阶段文字 (running 时显示) */
  currentStep?: string;
  /** 当前步骤进度(running 时用于 ETA 计算) */
  progress?: number;
  /** 总步骤数(running 时用于 ETA 计算) */
  total?: number;
  /** 阶段文本 fallback (例如 progress 字符串) */
  progressText?: string;
  /** started_at 用于计算已耗时 (running 时) */
  startedAt?: string | null;
  /** 完成后生成的文件数量 (success 时) */
  fileCount?: number;
  /** 总共计划生成数量 (success 时显示 "fileCount / total") */
  fileTotal?: number;
  /** 已归档路径 (success 时显示) */
  archivePath?: string;
  /** 错误信息 (failed 时) */
  errorMessage?: string;
  /** 进行中的 primary 动作按钮(下载/重新生成) */
  primaryLabel?: string;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  onPrimary?: () => void;
  /** 失败时的重试动作 */
  retryLabel?: string;
  onRetry?: () => void;
}

export function JobProgressItem({
  label,
  status,
  currentStep,
  progress,
  total,
  progressText,
  startedAt,
  fileCount,
  fileTotal,
  archivePath,
  errorMessage,
  primaryLabel,
  primaryLoading,
  primaryDisabled,
  onPrimary,
  retryLabel,
  onRetry,
}: JobProgressInfo) {
  if (status === 'idle') return null;

  if (status === 'running') {
    return (
      <div className="bg-card backdrop-blur-xl border border-border rounded-card p-4 shadow-glass">
        <div className="flex items-center justify-between mb-2">
          <span className="text-body font-medium text-text-primary">
            正在生成{label}...
          </span>
          <EtaBadge
            progress={progress}
            total={total}
            startedAt={startedAt ?? null}
          />
        </div>
        <ResearchProgress
          progress={progressText ?? (progress !== undefined && total !== undefined ? `${progress} / ${total}` : '准备中...')}
          currentStep={currentStep ?? ''}
          startedAt={startedAt ?? new Date().toISOString()}
        />
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-card p-3 shadow-glass flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-emerald-400 shrink-0" aria-hidden>
            ✓
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-text-primary">
              {label}已就绪
              {fileCount !== undefined && fileTotal !== undefined && (
                <span className="ml-2 text-helper text-text-secondary font-normal">
                  ({fileCount} / {fileTotal} 份)
                </span>
              )}
            </div>
            {archivePath && (
              <div className="text-helper text-emerald-400 truncate" title={archivePath}>
                📁 已归档:{archivePath}
              </div>
            )}
          </div>
        </div>
        {primaryLabel && onPrimary && (
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryDisabled || primaryLoading}
            className="shrink-0 h-9 px-4 text-body rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {primaryLoading ? '处理中...' : primaryLabel}
          </button>
        )}
      </div>
    );
  }

  // failed
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-card p-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-red-400 shrink-0" aria-hidden>
          ✗
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-text-primary">{label}失败</div>
          {errorMessage && (
            <div className="text-helper text-red-400 truncate" title={errorMessage}>
              {errorMessage}
            </div>
          )}
        </div>
      </div>
      {retryLabel && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 h-9 px-4 text-body rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * EtaBadge - 剩余时间估算徽章
 * 算法: 速度 = progress / elapsed_sec; remaining = (total - progress) / 速度
 * 启动 10 秒后才有足够样本,否则显示"计算中..."
 */
function EtaBadge({
  progress,
  total,
  startedAt,
}: {
  progress: number | undefined;
  total: number | undefined;
  startedAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  // 每 5 秒刷新一次,够 ETA 计算,无需每秒刷新
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  if (
    progress === undefined ||
    total === undefined ||
    startedAt === null ||
    total <= 0
  ) {
    return null;
  }

  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const elapsedSec = Math.max(1, (now - startMs) / 1000);

  // 启动 10 秒后再开始估算(避免前几秒样本不足)
  if (elapsedSec < 10 || progress <= 0) {
    return (
      <span className="text-helper text-text-tertiary shrink-0" title="样本累积中">
        ⏱ 计算中...
      </span>
    );
  }

  // 已完成 → 不显示
  if (progress >= total) {
    return null;
  }

  const rate = progress / elapsedSec; // steps/sec
  const remainingSec = (total - progress) / rate;
  return (
    <span
      className="text-helper text-primary-light shrink-0 tabular-nums"
      title="基于当前速度的剩余时间估算"
    >
      ⏱ 剩余约 {formatSeconds(remainingSec)}
    </span>
  );
}

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)} 秒`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec === 0 ? `${m} 分钟` : `${m} 分 ${sec} 秒`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}