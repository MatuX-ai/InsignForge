/**
 * Banner - 页面内联的统一提示组件
 * 替代散落的 <div className="text-helper text-red-400">...
 *
 * tone:
 *   - error:   红色边框 + 红色文字 (用于错误/失败提示)
 *   - warning: 琥珀色边框 (用于警告)
 *   - success: 翠绿色边框 (用于成功/notice)
 *   - info:    主色边框 (用于中性提示)
 *
 * 可选 props:
 *   - title: 顶部粗体小标题
 *   - onClose: 显示右侧 ✕ 关闭按钮
 *   - action: 右下角操作按钮 { label, onClick }
 *   - copyLabel / copyText: v1.8 P0-A6 错误诊断导出 - 显示「复制诊断」按钮,
 *     点击后调用 navigator.clipboard( web )或 desktop.copy( Electron ) 复制
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useDesktopApi } from '../hooks/useDesktopApi';

export type BannerTone = 'error' | 'warning' | 'success' | 'info';

export interface BannerAction {
  label: string;
  onClick: () => void;
}

interface Props {
  tone: BannerTone;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  action?: BannerAction;
  className?: string;
  /** v1.8 P0-A6: 复制按钮的文案,如 '复制诊断' */
  copyLabel?: string;
  /** v1.8 P0-A6: 复制的内容(错误堆栈/失败日志) */
  copyText?: string;
}

const toneStyles: Record<
  BannerTone,
  { container: string; icon: string; iconChar: string }
> = {
  error: {
    container: 'bg-red-500/10 border-red-500/30 text-red-400',
    icon: 'text-red-400',
    iconChar: '⚠',
  },
  warning: {
    container: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
    icon: 'text-amber-300',
    iconChar: '!',
  },
  success: {
    container: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    icon: 'text-emerald-400',
    iconChar: '✓',
  },
  info: {
    container: 'bg-primary/10 border-primary/30 text-primary-light',
    icon: 'text-primary-light',
    iconChar: 'ⓘ',
  },
};

export function Banner({
  tone,
  title,
  children,
  onClose,
  action,
  className = '',
  copyLabel,
  copyText,
}: Props) {
  const t = toneStyles[tone];
  const desktop = useDesktopApi();
  /** v1.8 P0-A6: 复制状态反馈 - 'idle' | 'done' | 'failed' */
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle');

  // 2s 后重置复制反馈,避免老错误状态悬挂
  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      if (desktop.isDesktop) {
        const res = await desktop.copy(copyText);
        if (!res?.ok) throw new Error(res?.message ?? '复制失败');
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyText);
      } else {
        throw new Error('当前环境不支持复制到剪贴板');
      }
      setCopyState('done');
    } catch (err) {
      console.warn('[Banner] 复制诊断失败:', err);
      setCopyState('failed');
    }
  };

  const showCopy = Boolean(copyLabel && copyText);

  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      // v1.8 P2-B: 从右侧滑入 + 渐入,200ms ease-out
      className={`flex items-start gap-3 rounded-card border px-4 py-3 backdrop-blur-sm text-helper if-banner-in ${t.container} ${className}`}
    >
      <span className={`shrink-0 mt-0.5 text-body font-medium ${t.icon}`} aria-hidden>
        {t.iconChar}
      </span>
      <div className="flex-1 min-w-0">
        {title && <div className="text-body font-medium mb-0.5">{title}</div>}
        <div className="leading-5 break-words whitespace-pre-wrap">{children}</div>
      </div>
      {(action || showCopy) && (
        <div className="shrink-0 flex items-center gap-3">
          {showCopy && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-live="polite"
              className="text-body hover:underline font-medium"
            >
              {copyState === 'done'
                ? '已复制 ✓'
                : copyState === 'failed'
                  ? '复制失败'
                  : copyLabel}
            </button>
          )}
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="text-body hover:underline font-medium"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
      {onClose && (
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="shrink-0 leading-none opacity-70 hover:opacity-100 transition-opacity"
        >
          ✕
        </button>
      )}
    </div>
  );
}