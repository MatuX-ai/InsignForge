/**
 * 通用弹窗组件 - 深色玻璃拟态主题
 * - 居中模态 + 半透明遮罩
 * - 支持 ESC 关闭、点击遮罩关闭
 * - 支持 primary / warning / danger 三种主题
 * - 内置 focus trap:打开时聚焦首按钮,Tab/Shift+Tab 在内部循环,关闭后还原焦点
 * - v1.8 P1-B: 支持 size 调节宽度 + bodyClassName 让大弹窗复用同一遮罩/焦点逻辑
 */
import { useEffect, useRef, type ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

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
  /** v1.8 P1-B: 弹窗宽度 - sm 320 / md 448(default) / lg 672 / xl 896 / full 1280 */
  size?: ModalSize;
  /** v1.8 P1-B: body 区域自定义(用于大弹窗需要滚动/全高布局),默认 space-y-2 */
  bodyClassName?: string;
  /** v1.8 P1-B: body 区域最大高度(如 max-h-[85vh])。传空表示不限制 */
  maxHeightClass?: string;
  /** v1.8 P1-B: 自定义 header 区域(默认 p-6 border-b border-border + h2),设置后会覆盖默认 header */
  header?: ReactNode;
  /** v1.8 P1-B: 完全自定义 footer 区域(传了就用自定义,否则用 primary/secondary 按钮) */
  footer?: ReactNode;
}

const sizeClassMap: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-[1280px]',
};

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
  size = 'md',
  bodyClassName,
  maxHeightClass,
  header,
  footer,
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
      // v1.8 P3-D: 使用 visibility check 代替 offsetParent,避免嵌套 display:none 元素被误判为不可见
      const isVisible = (el: Element): boolean => {
        const ht = el as HTMLElement;
        if (ht.offsetParent !== null || ht === (document.activeElement as Element)) return true;
        // offsetParent 为 null 但仍在视口内(例如 position:fixed): 用 getBoundingClientRect 验证
        const rect = ht.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const focusables = (Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ) as HTMLElement[]).filter(isVisible);
      if (focusables.length === 0) {
        // v1.8 P3-D: 容器内无任何可聚焦元素时,拦截 Tab 防止焦点漂到背景
        e.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // v1.8 P3-D: 如果焦点不在 Modal 内(例如用户点击了背景),主动拉回
      if (active === null || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
        return;
      }
      if (e.shiftKey) {
        if (active === first) {
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
      aria-labelledby={header ? undefined : 'modal-title'}
    >
      {/* v1.8 P2-B: 遮罩渐入, 默认 180ms ease-out */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm if-backdrop-in"
        onClick={maskClosable ? onClose : undefined}
      />
      {/* v1.8 P2-B: 弹窗主体上浮+渐入,200ms cubic-bezier(0.16, 1, 0.3, 1) */}
      <div
        ref={containerRef}
        className={`relative bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card shadow-glass w-full ${sizeClassMap[size]} if-panel-rise ${
          maxHeightClass ? `flex flex-col ${maxHeightClass}` : ''
        }`}
      >
        {header ?? (
          <h2 id="modal-title" className="text-section text-text-primary mb-3 font-semibold p-6 pb-0">
            {title}
          </h2>
        )}
        <div
          className={`text-body text-text-primary p-6 ${
            maxHeightClass ? 'flex-1 min-h-0 overflow-y-auto' : ''
          } ${bodyClassName ?? 'space-y-2'}`}
        >
          {children}
        </div>
        {(footer ?? (primaryLabel || secondaryLabel)) && (
          <div className="flex justify-end gap-2 p-6 pt-0">
            {footer ?? (
              <>
                {secondaryLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      onSecondary?.();
                      onClose();
                    }}
                    className="h-10 px-4 text-body text-text-secondary hover:text-text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
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
                    className={`h-10 px-5 text-body font-medium rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${primaryClass}`}
                  >
                    {primaryLabel}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
