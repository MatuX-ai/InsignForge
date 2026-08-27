/**
 * 通用弹窗组件 - 深色玻璃拟态主题
 * - 居中模态 + 半透明遮罩
 * - 支持 ESC 关闭、点击遮罩关闭
 * - 支持 primary / warning / danger 三种主题
 * - 内置 focus trap:打开时聚焦首按钮,Tab/Shift+Tab 在内部循环,关闭后还原焦点
 */
import { useEffect, useRef, type ReactNode } from 'react';

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
  tone?: 'primary' | 'warning' | 'danger';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Esc 关闭 + focus trap(在容器内循环)+ 开关时的焦点记录/还原
  useEffect(() => {
    if (!open) return;

    // 记录打开前的焦点元素,关闭时还原
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // 打开后聚焦 primary 按钮(优先)或首个可聚焦元素
    requestAnimationFrame(() => {
      const root = containerRef.current;
      if (root === null) return;
      const primary = root.querySelector<HTMLElement>('[data-autofocus]');
      const target =
        primary ??
        root.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
      target?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (root === null) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // 还原焦点
      const prev = previousFocusRef.current;
      if (prev !== null && typeof prev.focus === 'function') {
        prev.focus();
      }
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const primaryClass =
    tone === 'danger'
      ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-400 hover:to-red-500 shadow-glow-sm'
      : tone === 'warning'
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
      <div
        ref={containerRef}
        className="relative bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card shadow-glass w-full max-w-md p-6"
      >
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
              className="h-10 px-4 text-body text-text-secondary hover:text-text-primary transition-colors"
            >
              {secondaryLabel}
            </button>
          )}
          {primaryLabel && (
            <button
              type="button"
              data-autofocus
              onClick={() => {
                onPrimary?.();
                onClose();
              }}
              className={`h-10 px-5 text-body font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 ${primaryClass}`}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
