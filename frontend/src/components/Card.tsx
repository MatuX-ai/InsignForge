/**
 * 卡片组件 - 按前端设计文档 §5.3
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
      className={`bg-card border border-border rounded-card p-5 ${className}`}
    >
      {title && (
        <h2 className="text-section text-text-primary mb-3">{title}</h2>
      )}
      <div className="text-body text-text-primary">{children}</div>
    </div>
  );
}