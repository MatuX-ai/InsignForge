/**
 * 调研进度条 - 分析中卡片
 * 显示阶段名、进度文字、已耗时
 */
import { useEffect, useState } from 'react';

export function ResearchProgress({
  progress,
  currentStep,
  startedAt,
  className = '',
}: {
  progress: string;
  currentStep: string;
  startedAt: string;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState(() => calcElapsed(startedAt));

  // 每秒刷新已耗时显示
  useEffect(() => {
    setElapsed(calcElapsed(startedAt));
    const t = window.setInterval(() => setElapsed(calcElapsed(startedAt)), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-primary-light text-body">
            {progress || '分析中'}
            <span className="dot-1">.</span>
            <span className="dot-2">.</span>
            <span className="dot-3">.</span>
          </span>
        </div>
        <span className="text-label text-text-tertiary shrink-0" title="已耗时">
          ⏱ {elapsed}
        </span>
      </div>
      {currentStep && currentStep !== progress && (
        <div className="mt-1 text-helper text-text-secondary truncate">
          {currentStep}
        </div>
      )}
    </div>
  );
}

function calcElapsed(startedAt: string): string {
  const t = new Date(startedAt).getTime();
  if (!t || Number.isNaN(t)) return '0秒';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}分${s.toString().padStart(2, '0')}秒`;
  const h = Math.floor(m / 60);
  return `${h}小时${m % 60}分`;
}