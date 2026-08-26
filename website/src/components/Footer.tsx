/**
 * 页脚 - 多列链接 + 社交 + 版权
 */
import { Icon } from './Icon';
import { FOOTER_LINKS, SITE } from '../content/site';

export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-tertiary/50 backdrop-blur">
      <div className="container-wide py-16">
        <div className="grid gap-12 md:grid-cols-4">
          {/* 品牌区 */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2">
              <img
                src="./logo.png"
                alt="InsightForge"
                width={36}
                height={36}
                className="h-9 w-9"
              />
              <span className="text-lg font-semibold tracking-tight text-text-primary">
                Insight<span className="gradient-text">Forge</span>
              </span>
            </div>
            <p className="mt-4 text-sm text-text-secondary leading-relaxed">
              {SITE.description}
            </p>
            <div className="mt-6 flex items-center gap-3">
              <a
                href={SITE.repo}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="rounded-lg border border-border-solid p-2 text-text-secondary transition hover:border-primary/60 hover:text-text-primary"
              >
                <Icon name="github" className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* 产品列 */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
              产品
            </h3>
            <ul className="mt-4 space-y-3">
              {FOOTER_LINKS.product.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-sm text-text-secondary transition hover:text-text-primary">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* 资源列 */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
              资源
            </h3>
            <ul className="mt-4 space-y-3">
              {FOOTER_LINKS.resources.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target={link.href.startsWith('http') ? '_blank' : undefined}
                    rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    className="text-sm text-text-secondary transition hover:text-text-primary inline-flex items-center gap-1"
                  >
                    {link.label}
                    {link.href.startsWith('http') && (
                      <Icon name="external" className="h-3 w-3" />
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* 社区列 */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
              社区
            </h3>
            <ul className="mt-4 space-y-3">
              {FOOTER_LINKS.community.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-text-secondary transition hover:text-text-primary inline-flex items-center gap-1"
                  >
                    {link.label}
                    <Icon name="external" className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 版权行 */}
        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-8 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-text-tertiary">
            © {new Date().getFullYear()} InsightForge Team · 基于 MIT 协议开源
          </p>
          <p className="text-sm text-text-tertiary">
            当前版本 <span className="text-text-secondary">{SITE.currentVersion}</span> ·{' '}
            <a
              href={`${SITE.repo}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              LICENSE
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}