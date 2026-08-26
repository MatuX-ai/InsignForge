/**
 * 多行文本输入 - 深色玻璃拟态主题
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
          'w-full min-h-[120px] p-4 text-[15px] leading-6 text-text-primary ' +
          'bg-card-solid/50 border border-border rounded-lg resize-y ' +
          'focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 ' +
          'placeholder:text-text-tertiary backdrop-blur-sm transition-all ' +
          className
        }
      />
      {showCount && maxLength && (
        <div className="text-helper text-text-tertiary text-right mt-1">
          {length} / {maxLength}
        </div>
      )}
    </div>
  );
}
