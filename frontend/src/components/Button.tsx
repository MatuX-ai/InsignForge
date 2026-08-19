/**
 * 通用按钮 - 按前端设计文档 §5.1 三种类型
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'outline' | 'text';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-blue-700 active:bg-blue-800',
  outline:
    'bg-transparent text-primary border border-primary hover:bg-blue-50 active:bg-blue-100',
  text: 'bg-transparent text-primary hover:underline',
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
    'inline-flex items-center justify-center h-10 px-5 text-[15px] font-medium rounded ' +
    'transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none ' +
    'focus:ring-2 focus:ring-blue-300';
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