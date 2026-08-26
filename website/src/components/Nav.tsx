/**
 * 顶部导航 - 滚动时改变背景透明度,移动端汉堡菜单
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { NAV_LINKS, SITE } from '../content/site';

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-bg/85 backdrop-blur-xl border-b border-border shadow-glass'
          : 'bg-transparent'
      }`}
    >
      <div className="container-wide flex h-16 items-center justify-between">
        {/* Logo */}
        <a href="#top" className="flex items-center gap-2 font-semibold text-text-primary">
          <img
            src="./logo.png"
            alt="InsightForge"
            width={36}
            height={36}
            className="h-9 w-9"
          />
          <span className="text-lg tracking-tight">
            Insight<span className="gradient-text">Forge</span>
          </span>
        </a>

        {/* 桌面导航 */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="btn-ghost">
              {link.label}
            </a>
          ))}
        </nav>

        {/* 右侧 CTA */}
        <div className="hidden md:flex items-center gap-2">
          <a
            href={SITE.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost gap-2"
            aria-label="GitHub 仓库"
          >
            <Icon name="github" className="h-4 w-4" />
            <span>GitHub</span>
          </a>
          <a href="#download" className="btn-primary text-sm px-4 py-2">
            <Icon name="download" className="h-4 w-4" />
            下载
          </a>
        </div>

        {/* 移动端汉堡按钮 */}
        <button
          type="button"
          className="md:hidden rounded-lg p-2 text-text-primary hover:bg-bg-secondary"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="菜单"
          aria-expanded={mobileOpen}
        >
          <Icon name={mobileOpen ? 'x' : 'menu'} className="h-6 w-6" />
        </button>
      </div>

      {/* 移动端下拉菜单 */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-border bg-bg/95 backdrop-blur-xl">
          <div className="container-wide flex flex-col py-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2.5 text-text-primary hover:bg-bg-secondary"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
              <a
                href={SITE.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary justify-start"
              >
                <Icon name="github" className="h-4 w-4" />
                GitHub 仓库
              </a>
              <a href="#download" className="btn-primary justify-center">
                <Icon name="download" className="h-4 w-4" />
                下载
              </a>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}