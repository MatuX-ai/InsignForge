/**
 * 卡片组件 - 深色玻璃拟态主题
 *
 * v1.8 P6-C: 新增 action 插槽,允许在标题右侧放一个小按钮(目前用于批注按钮)
 */
import type { ReactNode, HTMLAttributes } from 'react';

type Tone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  /** 标题右侧的小操作(按钮 / 链接 / 任意 ReactNode) */
  action?: ReactNode;
  children: ReactNode;
  /** 视觉强调色(影响边框/标题颜色) */
  tone?: Tone;
}

const TONE_BORDER: Record<Tone, string> = {
  default: 'border-border',
  primary: 'border-primary/30',
  success: 'border-emerald-500/30',
  danger: 'border-red-500/30',
  warning: 'border-amber-500/30',
};

const TONE_TITLE: Record<Tone, string> = {
  default: 'text-text-primary',
  primary: 'text-primary-light',
  success: 'text-emerald-400',
  danger: 'text-red-400',
  warning: 'text-amber-300',
};

export function Card({
  title,
  action,
  children,
  className = '',
  tone = 'default',
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      className={`bg-card backdrop-blur-xl border ${TONE_BORDER[tone]} rounded-card p-5 shadow-glass ${className}`}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-2 mb-3">
          {title && (
            <h2
              className={`text-section font-semibold ${TONE_TITLE[tone]}`}
            >
              {title}
            </h2>
          )}
          {action && (
            <div className="shrink-0 flex items-center gap-1">
              {action}
            </div>
          )}
        </div>
      )}
      <div className="text-body text-text-primary">{children}</div>
    </div>
  );
}
