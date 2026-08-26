/**
 * 分发渠道区 - 4 种使用方式
 */
import { CHANNELS } from '../content/channels';
import { Icon } from '../components/Icon';
import { CodeBlock } from '../components/CodeBlock';
import { useRevealAll } from '../hooks/useReveal';

export function Channels() {
  const ref = useRevealAll<HTMLDivElement>();

  return (
    <section id="channels" className="section">
      <div ref={ref} className="container-wide">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="reveal badge mx-auto mb-4">分发渠道</p>
          <h2 className="reveal heading-2 text-text-primary">
            四种形态,任选其一
          </h2>
          <p className="reveal mt-4 text-lg text-text-secondary">
            桌面版、容器版、AI 工具链插件、模型上下文协议 —— 找到最适合你的使用方式。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {CHANNELS.map((c) => (
            <article
              key={c.id}
              className="reveal glass-card flex flex-col gap-5 p-6 transition hover:border-primary/40"
            >
              <header className="flex items-start justify-between gap-4">
                <div>
                  <span className="badge mb-3">
                    <Icon
                      name={
                        c.id === 'desktop'
                          ? 'desktop'
                          : c.id === 'web'
                            ? 'docker'
                            : c.id === 'dsh'
                              ? 'plug'
                              : 'code'
                      }
                      className="h-3.5 w-3.5"
                    />
                    {c.badge}
                  </span>
                  <h3 className="text-xl font-semibold text-text-primary">{c.name}</h3>
                  <p className="mt-1 text-xs text-text-tertiary">面向:{c.audience}</p>
                </div>
                {c.href && (
                  <a href={c.href} className="btn-ghost text-xs">
                    查看 →
                  </a>
                )}
              </header>

              <p className="text-sm text-text-secondary leading-relaxed">
                {c.description}
              </p>

              <CodeBlock commands={c.installCommands} />

              <ul className="grid gap-2 sm:grid-cols-2">
                {c.pros.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2 text-xs text-text-secondary"
                  >
                    <Icon name="check" className="h-3.5 w-3.5 text-success" />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}