/**
 * 滚动渐入 hook - 给元素加 .reveal / .is-visible 类
 * 使用 IntersectionObserver 避免监听 scroll 事件
 *
 * 健壮性策略:
 * - 首屏元素挂载时立即可见,避免空白
 * - 视口外元素用 IntersectionObserver 监听
 * - 加 4s 全局兜底定时器,防止任何元素因 observer 失效永久隐藏
 *   (例如快速滚动、JS 异常、observer 缺失时的 SEO 兜底)
 */
import { useEffect, useRef, type RefObject } from 'react';

function setupFallback(): void {
  // 全局兜底:4s 后强制所有剩余 .reveal 元素可见
  // 只在浏览器环境运行,SSR 跳过
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    document.querySelectorAll<HTMLElement>('.reveal:not(.is-visible)').forEach((el) => {
      el.classList.add('is-visible');
    });
  }, 4000);
}

export function useReveal<T extends HTMLElement = HTMLDivElement>(): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    setupFallback();

    const node = ref.current;
    if (!node) return;

    // 立即显示(避免首屏不滚动时一片空白)
    if (node.getBoundingClientRect().top < window.innerHeight) {
      node.classList.add('is-visible');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -80px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/**
 * 批量版本 - 一次性观察所有匹配选择器的子元素
 * 用法:<div ref={containerRef}>...children with className="reveal"...</div>
 */
export function useRevealAll<T extends HTMLElement = HTMLDivElement>(
  selector = '.reveal'
): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    setupFallback();

    const container = ref.current;
    if (!container) return;

    const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
    items.forEach((item) => {
      const rect = item.getBoundingClientRect();
      if (rect.top < window.innerHeight) {
        item.classList.add('is-visible');
      }
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );

    items.forEach((item) => {
      if (!item.classList.contains('is-visible')) {
        observer.observe(item);
      }
    });

    return () => observer.disconnect();
  }, [selector]);

  return ref;
}