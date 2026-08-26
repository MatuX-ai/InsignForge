/**
 * 更新日志 + 路线图
 */
import { CHANGELOG, ROADMAP } from '../content/changelog';
import { Icon } from '../components/Icon';
import { useRevealAll } from '../hooks/useReveal';

export function Changelog() {
  const ref = useRevealAll<HTMLDivElement>();

  return (
    <section id="changelog" className="section">
      <div ref={ref} className="container-wide">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="reveal badge mx-auto mb-4">更新日志 & 路线图</p>
          <h2 className="reveal heading-2 text-text-primary">持续迭代中</h2>
          <p className="reveal mt-4 text-lg text-text-secondary">
            我们每月发布小版本,每季度发布功能版本。所有变更都有完整的 release notes。
          </p>
        </div>

        <div className="grid gap-12 lg:grid-cols-2">
          {/* Changelog */}
          <div>
            <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold text-text-primary">
              <Icon name="check" className="h-5 w-5 text-success" />
              已发布
            </h3>
            <ol className="relative space-y-6 border-l border-border-solid pl-6">
              {CHANGELOG.map((entry) => (
                <li key={entry.version} className="reveal relative">
                  <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary ring-4 ring-bg" />
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm font-semibold text-primary-light">
                      {entry.version}
                    </span>
                    <span className="text-xs text-text-tertiary">{entry.date}</span>
                    {entry.channel && (
                      <span className="badge text-[10px] py-0.5">
                        {entry.channel === 'all' ? '全渠道' : entry.channel}
                      </span>
                    )}
                  </div>
                  <h4 className="mt-1 font-semibold text-text-primary">{entry.title}</h4>
                  <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                    {entry.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-tertiary" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>

          {/* Roadmap */}
          <div>
            <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold text-text-primary">
              <Icon name="arrow" className="h-5 w-5 text-primary-light" />
              路线图
            </h3>
            <ol className="relative space-y-6 border-l border-border-solid pl-6">
              {ROADMAP.map((entry) => (
                <li key={entry.version} className="reveal relative">
                  <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary-light bg-bg" />
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm font-semibold text-text-secondary">
                      {entry.version}
                    </span>
                    <span className="text-xs text-text-tertiary">{entry.date}</span>
                  </div>
                  <h4 className="mt-1 font-semibold text-text-primary">{entry.title}</h4>
                  <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                    {entry.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-tertiary" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}