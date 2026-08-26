/**
 * 通用弹窗组件 - 深色玻璃拟态主题
 * - 居中模态 + 半透明遮罩
 * - 支持 ESC 关闭、点击遮罩关闭
 * - 支持 primary / warning 两种主题
 */
import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  maskClosable?: boolean;
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
      ? 'bg-gradient-to-r from-warning to-amber-600 text-white hover:from-amber-500 hover:to-amber-700 shadow-glow-sm'
      : 'bg-gradient-to-r from-primary to-primary-dark text-white hover:from-primary-light hover:to-primary shadow-glow-sm';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={maskClosable ? onClose : undefined}
      />
      {/* 弹窗本体 - 玻璃拟态 */}
      <div className="relative bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card shadow-glass w-full max-w-md p-6">
        <h2 id="modal-title" className="text-section text-text-primary mb-3 font-semibold">
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
              className={`h-10 px-5 text-[15px] font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 ${primaryClass}`}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
