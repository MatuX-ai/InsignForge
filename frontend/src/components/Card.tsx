/**
 * 卡片组件 - 深色玻璃拟态主题
 */
import type { ReactNode, HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  children: ReactNode;
}

export function Card({ title, children, className = '', ...rest }: Props) {
  return (
    <div
      {...rest}
      className={`bg-card backdrop-blur-xl border border-border rounded-card p-5 shadow-glass ${className}`}
    >
      {title && (
        <h2 className="text-section text-text-primary mb-3 font-semibold">{title}</h2>
      )}
      <div className="text-body text-text-primary">{children}</div>
    </div>
  );
}
