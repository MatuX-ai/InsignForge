/**
 * 多行文本输入 - 深色玻璃拟态主题
 *
 * v1.8 P0-A4:
 *   - 加 onCmdEnter 回调,用户在桌面端可用 Ctrl+Enter / Cmd+Enter 提交.
 *   - Shift+Enter 仍为换行(桌面端习惯,受 Notion / Slack / Cursor 等领先 IDE 影响)
 *   - 单焦点环与 Button 一致(focus-visible:ring-2 / focus-visible:ring-offset-2)
 */
import type { TextareaHTMLAttributes, KeyboardEvent } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  showCount?: boolean;
  /**
   * Ctrl+Enter / Cmd+Enter / Alt+Enter 任一组合时调用(Shift+Enter 仍为换行).
   * 不提供时需手动绑定 onKeyDown;同时不提供时组件不拦截任何键盘事件.
   */
  onCmdEnter?: () => void;
}

export function Textarea({
  showCount = true,
  className = '',
  value,
  maxLength,
  onCmdEnter,
  onKeyDown,
  ...rest
}: Props) {
  const length = typeof value === 'string' ? value.length : 0;
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onCmdEnter && e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.altKey) && !e.shiftKey) {
      e.preventDefault();
      onCmdEnter();
      return;
    }
    onKeyDown?.(e);
  };
  return (
    <div className="w-full">
      <textarea
        {...rest}
        value={value}
        maxLength={maxLength}
        onKeyDown={handleKeyDown}
        className={
          'w-full min-h-[120px] p-4 text-[15px] leading-6 text-text-primary ' +
          'bg-card-solid/50 border border-border rounded-lg resize-y ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ' +
          'focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
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
