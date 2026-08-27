/**
 * Tooltip - 轻量提示气泡
 * hover / focus 时显示说明文案
 */
import { useState, type ReactNode } from 'react';

interface Props {
  content: ReactNode;
  children: ReactNode;
  /** 'top' | 'bottom' | 'left' | 'right' */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const PLACEMENT_STYLES: Record<NonNullable<Props['placement']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

export function Tooltip({
  content,
  children,
  placement = 'top',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`absolute z-30 ${PLACEMENT_STYLES[placement]} px-3 py-2 text-helper text-text-primary bg-card-solid/95 backdrop-blur-xl border border-border rounded-lg shadow-glass max-w-xs whitespace-pre-wrap`}
        >
          {content}
        </span>
      )}
    </span>
  );
}