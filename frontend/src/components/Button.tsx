/**
 * 通用按钮 - 深色玻璃拟态主题
 * 三种变体: primary / outline / text
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'outline' | 'text';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
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
  ...rest
}: Props) {
  const base =
    'inline-flex items-center justify-center h-10 px-5 text-body font-medium rounded-lg ' +
    'transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none ' +
    'focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-bg';
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${className}`}
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
