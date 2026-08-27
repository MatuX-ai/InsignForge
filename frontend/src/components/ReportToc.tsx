/**
 * ReportToc - 报告章节导航条
 * 横滚胶囊 + 滚动联动(active section 高亮)
 *
 * 使用方式:
 *   <ReportToc items={[{id:'section-xxx', label:'标题'}, ...]} />
 *
 * 每个 item.id 对应页面中 section[id],点击时平滑滚动。
 */
import { useEffect, useRef, useState } from 'react';

export interface TocItem {
  id: string;
  label: string;
}

interface Props {
  items: TocItem[];
}

export function ReportToc({ items }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver 监听当前活跃 section
  useEffect(() => {
    if (items.length === 0) return;
    const sections = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const visibility = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibility.set(entry.target.id, entry.intersectionRatio);
        });
        // 选可见度最高的
        let bestId: string | null = null;
        let bestRatio = 0;
        visibility.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        });
        if (bestId !== null) setActiveId(bestId);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [items]);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el === null) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 立刻高亮,无需等 observer
    setActiveId(id);
  };

  // 方向键导航(参考 WAI-ARIA tablist 规范)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    if (buttons.length === 0) return;
    const currentIdx = buttons.findIndex(
      (b) => b === document.activeElement || b.getAttribute('aria-selected') === 'true',
    );
    const idx = currentIdx === -1 ? 0 : currentIdx;
    let nextIdx = idx;
    switch (e.key) {
      case 'ArrowRight':
        nextIdx = (idx + 1) % buttons.length;
        break;
      case 'ArrowLeft':
        nextIdx = (idx - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = buttons.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const nextBtn = buttons[nextIdx];
    if (nextBtn === undefined) return;
    nextBtn.focus();
    handleClick(nextBtn.dataset.tocId ?? '');
  };

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="报告章节"
      className="sticky top-14 z-10 -mx-6 px-6 py-3 bg-bg/80 backdrop-blur-xl border-b border-border/40"
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="报告章节导航"
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
      >
        {items.map((it) => {
          const isActive = activeId === it.id;
          return (
            <button
              key={it.id}
              role="tab"
              aria-selected={isActive}
              data-testid={`toc-${it.id}`}
              data-toc-id={it.id}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleClick(it.id)}
              className={`shrink-0 h-8 px-3 rounded-full text-helper font-medium transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-primary/20 text-primary-light border border-primary/40'
                  : 'bg-card/60 text-text-secondary border border-transparent hover:border-border hover:text-text-primary'
              }`}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}