/**
 * 多行文本输入 - 按前端设计文档 §5.2
 */
import type { TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  showCount?: boolean;
}

export function Textarea({ showCount = true, className = '', value, maxLength, ...rest }: Props) {
  const length = typeof value === 'string' ? value.length : 0;
  return (
    <div className="w-full">
      <textarea
        {...rest}
        value={value}
        maxLength={maxLength}
        className={
          'w-full min-h-[120px] p-3 text-[15px] leading-6 text-text-primary ' +
          'bg-card border border-border rounded resize-y ' +
          'focus:outline-none focus:border-primary focus:ring-2 focus:ring-blue-100 ' +
          'placeholder:text-text-secondary ' +
          className
        }
      />
      {showCount && maxLength && (
        <div className="text-helper text-text-secondary text-right mt-1">
          {length} / {maxLength}
        </div>
      )}
    </div>
  );
}