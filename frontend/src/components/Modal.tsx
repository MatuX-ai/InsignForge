/**
 * 通用弹窗组件 - 按前端设计文档 §3.4 风格
 * - 居中模态 + 半透明遮罩
 * - 支持 ESC 关闭、点击遮罩关闭(可关闭)
 * - 支持自定义标题/正文/操作按钮
 */
import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** 主要操作按钮文案(右侧) */
  primaryLabel?: string;
  onPrimary?: () => void;
  /** 次要操作按钮文案(左侧) */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** 是否允许点击遮罩关闭,默认 true */
  maskClosable?: boolean;
  /** 主题色,默认主色;警告场景可用 warning */
  tone?: 'primary' | 'warning';
}

export function Modal({
  open,
  title,
  children,
  onClose,
  primaryLabel,
  onPrimary,
  secondaryLabel = '稍后再说',
  onSecondary,
  maskClosable = true,
  tone = 'primary',
}: Props) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const primaryClass =
    tone === 'warning'
      ? 'bg-warning text-white hover:bg-amber-700 active:bg-amber-800'
      : 'bg-primary text-white hover:bg-blue-700 active:bg-blue-800';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={maskClosable ? onClose : undefined}
      />
      {/* 弹窗本体 */}
      <div className="relative bg-card border border-border rounded-card shadow-xl w-full max-w-md p-6">
        <h2 id="modal-title" className="text-section text-text-primary mb-3">
          {title}
        </h2>
        <div className="text-body text-text-primary mb-6 space-y-2">
          {children}
        </div>
        <div className="flex justify-end gap-2">
          {secondaryLabel && (
            <button
              type="button"
              onClick={() => {
                onSecondary?.();
                onClose();
              }}
              className="h-10 px-4 text-[15px] text-text-secondary hover:text-text-primary transition-colors"
            >
              {secondaryLabel}
            </button>
          )}
          {primaryLabel && (
            <button
              type="button"
              onClick={() => {
                onPrimary?.();
                onClose();
              }}
              className={`h-10 px-5 text-[15px] font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 ${primaryClass}`}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}