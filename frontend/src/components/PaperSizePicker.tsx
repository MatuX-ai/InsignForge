/**
 * PaperSizePicker - 纸张大小 + 方向选择器 (v1.8 P1-D)
 *
 * 嵌入 Report 页操作按钮区,提供:
 *   - 纸张大小:A4 / A3 / A5 / Letter / Legal(单击切换,持久化)
 *   - 方向:纵向 / 横向(单击切换,持久化)
 *   - 当前选中以紧凑按钮形式展示,点击展开 panel
 *
 * 与 pdfPreferences.ts 协作:
 *   - 选择立刻写入 localStorage
 *   - 同时调用 applyPaperSize() 注入 @page 规则,浏览器打印 / 后端 PDF 都生效
 *
 * a11y:
 *   - 用 radio(role=radio) 而非按钮,语义更准确
 *   - 方向切换用 single-toggle 按钮,符合 "二选一" 模式
 *   - Escape / 点击外部关闭,焦点还原到 trigger
 */
import { useEffect, useRef, useState } from 'react';
import {
  loadPdfPreferences,
  savePdfPreferences,
  applyPaperSize,
  PAPER_SIZES,
  ORIENTATIONS,
  type PaperSize,
  type Orientation,
} from '../lib/pdfPreferences';

interface Props {
  disabled?: boolean;
}

export function PaperSizePicker({ disabled }: Props) {
  const [prefs, setPrefs] = useState(() => loadPdfPreferences());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // 选择变化 → 持久化 + 注入 @page
  useEffect(() => {
    savePdfPreferences(prefs);
    applyPaperSize(prefs);
  }, [prefs]);

  // 点击外部 / Esc 关闭 + 焦点还原
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const orient = ORIENTATIONS.find((o) => o.value === prefs.orientation)!;
  const size = PAPER_SIZES.find((s) => s.value === prefs.paperSize)!;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`纸张: ${size.label} ${orient.label},点击切换`}
        title={`当前: ${size.label} ${orient.label} · 点击切换`}
        className="inline-flex items-center gap-1.5 px-3 py-2 h-[40px] rounded-lg border border-border bg-card-solid/40 text-text-secondary hover:text-text-primary hover:bg-card-solid/70 transition-colors text-body focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
      >
        <span aria-hidden>{orient.emoji}</span>
        <span className="font-medium">{size.label}</span>
        <span className="text-text-tertiary text-helper">{orient.label}</span>
        <span aria-hidden className="text-helper">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="选择纸张大小与方向"
          className="absolute right-0 mt-2 w-[280px] bg-card-solid/95 backdrop-blur-2xl border border-border rounded-lg shadow-glass z-30 overflow-hidden if-panel-rise"
        >
          <div className="px-3 py-2 border-b border-border text-helper text-text-secondary">
            PDF 纸张
          </div>

          {/* 纸张大小 */}
          <div className="px-3 pt-2 pb-1 text-label text-text-tertiary uppercase tracking-wide">
            纸张大小
          </div>
          <div className="px-2 pb-2 grid grid-cols-1 gap-1" role="radiogroup" aria-label="纸张大小">
            {PAPER_SIZES.map((s) => {
              const selected = s.value === prefs.paperSize;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPrefs((p) => ({ ...p, paperSize: s.value as PaperSize }))}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    selected
                      ? 'bg-primary/15 text-text-primary border border-primary/40'
                      : 'hover:bg-hover-bg text-text-secondary border border-transparent'
                  }`}
                >
                  <span className="font-medium text-body">{s.label}</span>
                  <span className="text-helper text-text-tertiary">{s.desc}</span>
                  {selected && (
                    <span aria-hidden className="text-primary-light text-helper">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 方向 */}
          <div className="px-3 pt-2 pb-1 text-label text-text-tertiary uppercase tracking-wide border-t border-border">
            方向
          </div>
          <div className="px-2 pb-3 grid grid-cols-2 gap-1">
            {ORIENTATIONS.map((o) => {
              const selected = o.value === prefs.orientation;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={o.label}
                  onClick={() => setPrefs((p) => ({ ...p, orientation: o.value as Orientation }))}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                    selected
                      ? 'bg-primary/15 text-text-primary border border-primary/40'
                      : 'hover:bg-hover-bg text-text-secondary border border-transparent'
                  }`}
                >
                  <span aria-hidden>{o.emoji}</span>
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
