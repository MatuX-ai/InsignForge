/**
 * 顶部导航 - 深色玻璃拟态主题
 * 高度 56px,左侧 logo,右侧 [首页][梳理][历史][设置]
 */
import { Link, useLocation } from 'react-router-dom';

const tabs: Array<{ path: string; label: string }> = [
  { path: '/', label: '首页' },
  { path: '/discuss', label: '梳理' },
  { path: '/history', label: '历史' },
  { path: '/settings', label: '设置' },
];

export function TopBar() {
  const location = useLocation();
  return (
    <header className="h-14 bg-card/80 backdrop-blur-xl border-b border-border flex items-center px-6 sticky top-0 z-20 shadow-glass">
      <Link to="/" className="text-section text-text-primary font-semibold mr-8 bg-gradient-to-r from-primary-light to-accent bg-clip-text text-transparent">
        InsightForge
      </Link>
      <nav className="flex gap-6">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`text-[15px] transition-all duration-200 relative ${
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
      <div className="ml-auto text-helper text-text-tertiary">
        v1.0 · 个人版
      </div>
    </header>
  );
}
