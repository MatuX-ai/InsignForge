/**
 * 顶部导航 - 按前端设计文档 §2.1
 * 高度 56px,左侧 logo,右侧 [首页][历史][设置]
 */
import { Link, useLocation } from 'react-router-dom';

const tabs: Array<{ path: string; label: string }> = [
  { path: '/', label: '首页' },
  { path: '/history', label: '历史' },
  { path: '/settings', label: '设置' },
];

export function TopBar() {
  const location = useLocation();
  return (
    <header className="h-14 bg-card border-b border-border flex items-center px-6 sticky top-0 z-10">
      <Link to="/" className="text-section text-text-primary font-semibold mr-8">
        InsightForge
      </Link>
      <nav className="flex gap-6">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`text-[15px] transition-colors ${
                active
                  ? 'text-primary font-medium'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto text-helper text-text-secondary">
        v1.0 · 个人版
      </div>
    </header>
  );
}