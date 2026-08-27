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
 */
import type { ReactNode } from 'react';

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

export function Banner({ tone, title, children, onClose, action, className = '' }: Props) {
  const t = toneStyles[tone];
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-card border px-4 py-3 backdrop-blur-sm text-helper ${t.container} ${className}`}
    >
      <span className={`shrink-0 mt-0.5 text-body font-medium ${t.icon}`} aria-hidden>
        {t.iconChar}
      </span>
      <div className="flex-1 min-w-0">
        {title && <div className="text-body font-medium mb-0.5">{title}</div>}
        <div className="leading-5 break-words whitespace-pre-wrap">{children}</div>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 text-body hover:underline font-medium"
        >
          {action.label}
        </button>
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