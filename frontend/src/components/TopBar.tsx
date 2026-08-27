/**
 * 顶部导航 - 深色玻璃拟态主题
 * 桌面端:横排 nav
 * 移动端:右上角汉堡按钮,展开下拉菜单
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const tabs: Array<{ path: string; label: string }> = [
  { path: '/', label: '首页' },
  { path: '/discuss', label: '梳理' },
  { path: '/history', label: '历史' },
  { path: '/settings', label: '设置' },
];

export function TopBar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 路由切换自动关闭菜单
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <header className="h-14 bg-card/80 backdrop-blur-xl border-b border-border flex items-center px-4 sm:px-6 sticky top-0 z-20 shadow-glass">
      <Link
        to="/"
        className="text-section text-text-primary font-semibold mr-6 sm:mr-8 bg-gradient-to-r from-primary-light to-accent bg-clip-text text-transparent"
      >
        InsightForge
      </Link>

      {/* 桌面端横排 nav */}
      <nav className="hidden md:flex gap-6">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`text-body transition-all duration-200 relative ${
                active
                  ? 'text-primary-light font-medium'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
              {active && (
                <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-accent rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* 右侧:版本号(桌面) + 汉堡(移动) */}
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden md:block text-helper text-text-tertiary">
          v1.0 · 个人版
        </div>

        {/* 移动端汉堡按钮 */}
        <div ref={menuRef} className="md:hidden relative">
          <button
            type="button"
            aria-label={open ? '关闭菜单' : '打开菜单'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-primary hover:bg-hover-bg border border-border transition-colors"
          >
            {open ? '✕' : '☰'}
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-44 bg-card-solid/95 backdrop-blur-2xl border border-border rounded-lg shadow-glass z-30 overflow-hidden"
            >
              {tabs.map((tab) => {
                const active = location.pathname === tab.path;
                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    role="menuitem"
                    className={`block px-4 py-3 text-body transition-colors ${
                      active
                        ? 'text-primary-light bg-primary/10 font-medium'
                        : 'text-text-primary hover:bg-hover-bg'
                    }`}
                  >
                    {tab.label}
                  </Link>
                );
              })}
              <div className="px-4 py-2 text-helper text-text-tertiary border-t border-border">
                v1.0 · 个人版
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}