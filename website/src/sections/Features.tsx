/**
 * 核心特性区 - 8 卡片网格
 */
import { FEATURES } from '../content/features';
import { Icon } from '../components/Icon';
import { useRevealAll } from '../hooks/useReveal';

export function Features() {
  const ref = useRevealAll<HTMLDivElement>();

  return (
    <section id="features" className="section relative">
      <div className="container-wide">
        <div ref={ref} className="mx-auto max-w-2xl text-center mb-16">
          <p className="reveal badge mx-auto mb-4">核心特性</p>
          <h2 className="reveal heading-2 text-text-primary">
            不只是「另一个 AI 写作工具」
          </h2>
          <p className="reveal mt-4 text-lg text-text-secondary">
            从隐私到分发,从智能体到开放接口 —— 我们专注于把「市场验证」这一件事做到极致。
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="reveal glass-card group p-6 transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 text-primary-light transition group-hover:from-primary/30 group-hover:to-accent/30">
                <Icon name={f.icon} className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-text-primary">{f.title}</h3>
              <p className="mt-2 text-sm text-text-secondary leading-relaxed">
                {f.description}
              </p>
              {f.highlight && (
                <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary-light">
                  <span className="h-1 w-1 rounded-full bg-primary-light" />
                  {f.highlight}
                </p>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}