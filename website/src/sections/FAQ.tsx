/**
 * FAQ 区 - 手风琴样式(默认收起,点击展开)
 */
import { useState } from 'react';
import { FAQS } from '../content/faq';
import { Icon } from '../components/Icon';
import { useRevealAll } from '../hooks/useReveal';

export function FAQ() {
  const ref = useRevealAll<HTMLDivElement>();
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="section">
      <div ref={ref} className="container-narrow">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="reveal badge mx-auto mb-4">常见问题</p>
          <h2 className="reveal heading-2 text-text-primary">
            关于 InsightForge,你可能想问
          </h2>
          <p className="reveal mt-4 text-lg text-text-secondary">
            没有找到答案?欢迎在{' '}
            <a
              href="https://github.com/MatuX-ai/InsignForge/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              GitHub Issue
            </a>{' '}
            中提问。
          </p>
        </div>

        <div className="space-y-3">
          {FAQS.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={item.q}
                className="reveal glass-card overflow-hidden transition hover:border-primary/40"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-medium text-text-primary">{item.q}</span>
                  <Icon
                    name="chevron"
                    className={`h-5 w-5 shrink-0 text-text-tertiary transition-transform ${
                      isOpen ? 'rotate-180 text-primary-light' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-border bg-bg-tertiary/30 px-5 py-4 text-sm text-text-secondary leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}