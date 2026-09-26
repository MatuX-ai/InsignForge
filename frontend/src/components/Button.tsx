/**
 * 通用按钮 - 深色玻璃拟态主题
 * 三种变体: primary / outline / text
 *
 * a11y / 桌面端体验要点(v1.8 P0-A5):
 *   - 使用 focus-visible 而非 focus:只在键盘聚焦时显出环,鼠标点击不刺眼
 *   - 三个 variant 统一的 active:scale-[0.98] 按下反馈,符合桌面端习惯
 *   - loading=true 时锁定 min-width,避免'分析中...'文本宽度变化导致布局跳动
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'outline' | 'text';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  /** 加载中的最小宽度(像素),避免按钮宽度跟随文本变化抖动 */
  loadingMinWidth?: number;
  children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-primary to-primary-dark text-white hover:from-primary-light hover:to-primary active:from-primary-dark active:to-primary-dark shadow-glow-sm hover:shadow-glow transition-all',
  outline:
    'bg-transparent text-primary border border-primary/50 hover:bg-primary/10 hover:border-primary active:bg-primary/20 backdrop-blur-sm transition-all',
  text: 'bg-transparent text-primary hover:text-primary-light hover:underline transition-colors',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  loadingMinWidth = 96,
  type = 'button',
  ...rest
}: Props) {
  const base =
    'inline-flex items-center justify-center h-10 px-5 text-body font-medium rounded-lg ' +
    'transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
    'active:scale-[0.98] motion-reduce:active:scale-100';
  // loading 时锁定最小宽度,避免文案收缩/展开造成按钮横向跳动
  const widthLock = loading ? `min-w-[${loadingMinWidth}px]` : '';
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${variants[variant]} ${widthLock} ${className}`}
    >
      {loading ? (
        <span className="inline-flex items-center gap-1">
          分析中
          <span className="dot-1">.</span>
          <span className="dot-2">.</span>
          <span className="dot-3">.</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
