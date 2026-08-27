/**
 * Dropdown - 轻量下拉菜单组件
 * 基于原生 popover/click-outside 实现,不引入额外依赖
 *
 * 使用方式:
 *   <Dropdown
 *     trigger={<Button>菜单 ▾</Button>}
 *     items={[
 *       { label: '复制', onClick: handleCopy },
 *       { label: '下载', onClick: handleDownload },
 *     ]}
 *   />
 */
import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

// 透传给底层 trigger 元素的额外属性
interface TriggerExtras {
  ref?: React.Ref<HTMLElement>;
}

export interface DropdownItem {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'default' | 'danger';
  testId?: string;
}

interface Props {
  trigger: ReactElement;
  items: DropdownItem[];
  align?: 'left' | 'right';
  panelClassName?: string;
}

export function Dropdown({
  trigger,
  items,
  align = 'right',
  panelClassName = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 真实 trigger 元素 ref(用于关闭后还原焦点)
  const triggerRef = useRef<HTMLElement | null>(null);

  // 关闭时统一还原焦点到 trigger
  const closeAndRestoreFocus = () => {
    setOpen(false);
    // 下一帧再聚焦,确保 menu 已 unmount(避免焦点被夺回)
    requestAnimationFrame(() => {
      const t = triggerRef.current;
      if (t !== null && typeof t.focus === 'function') {
        t.focus();
      }
    });
  };

  // 点外部关闭 + 键盘关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeAndRestoreFocus();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAndRestoreFocus();
        return;
      }
      // ↑↓ 在菜单项间循环
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const menu = menuRef.current;
        if (menu === null) return;
        const menuItems = Array.from(
          menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
        );
        if (menuItems.length === 0) return;
        e.preventDefault();
        const active = document.activeElement as HTMLButtonElement | null;
        const currentIdx =
          active !== null && active instanceof HTMLButtonElement
            ? menuItems.indexOf(active)
            : -1;
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx =
          currentIdx === -1
            ? 0
            : (currentIdx + dir + menuItems.length) % menuItems.length;
        menuItems[nextIdx]?.focus();
      }
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 打开时自动聚焦首个可用的菜单项(让键盘能直接操作)
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const first = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      );
      first?.focus();
    });
  }, [open]);

  // 透传 trigger 上的 disabled: 当所有 item 都不可用时 trigger 也禁用
  const allDisabled = items.every((it) => it.disabled);

  // 替换 trigger 上的 onClick,使其点击切换 open + 注入 ref 用于还原焦点
  const triggerEl = trigger as ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    disabled?: boolean;
  }>;
  const clonedTrigger = (
    <span
      onClick={(e) => {
        if (allDisabled) return;
        triggerEl.props.onClick?.(e);
        setOpen((v) => !v);
      }}
      aria-disabled={allDisabled}
      className={allDisabled ? 'pointer-events-none opacity-50' : ''}
    >
      {cloneElement(trigger, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
        },
      } as TriggerExtras)}
    </span>
  );

  const handleItem = (it: DropdownItem) => {
    if (it.disabled || it.loading) return;
    closeAndRestoreFocus();
    it.onClick();
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      {clonedTrigger}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="下拉菜单"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-2 min-w-[180px] bg-card-solid/95 backdrop-blur-2xl border border-border rounded-lg shadow-glass z-20 overflow-hidden ${panelClassName}`}
        >
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              data-testid={it.testId}
              disabled={it.disabled || it.loading}
              onClick={() => handleItem(it)}
              className={`w-full text-left px-4 py-2 text-body flex items-center justify-between gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                it.tone === 'danger'
                  ? 'text-red-400 hover:bg-red-500/10'
                  : 'text-text-primary hover:bg-hover-bg'
              }`}
            >
              <span>{it.label}</span>
              {it.loading && <span className="text-label text-text-tertiary">...</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}