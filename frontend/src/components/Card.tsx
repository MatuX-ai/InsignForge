/**
 * 卡片组件 - 深色玻璃拟态主题
 */
import type { ReactNode, HTMLAttributes } from 'react';

type Tone = 'default' | 'primary' | 'success' | 'danger' | 'warning';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
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
      {title && (
        <h2
          className={`text-section mb-3 font-semibold ${TONE_TITLE[tone]}`}
        >
          {title}
        </h2>
      )}
      <div className="text-body text-text-primary">{children}</div>
    </div>
  );
}
