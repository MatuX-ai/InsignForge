/**
 * 底部导航 - 深色玻璃拟态主题
 * 项目资源入口
 */
import { Link, useLocation } from 'react-router-dom';

type Item =
  | { kind: 'route'; path: string; label: string }
  | { kind: 'external'; href: string; label: string };

const items: Item[] = [
  { kind: 'route', path: '/readme', label: 'readme' },
  {
    kind: 'external',
    href: 'https://github.com/MatuX-ai/InsignForge',
    label: 'GitHub 仓库',
  },
  {
    kind: 'external',
    href: 'https://github.com/MatuX-ai/InsignForge/tree/main/dsh-plugin/insightforge-dsh-plugin',
    label: 'DeepSeek Harness 插件',
  },
  { kind: 'route', path: '/faq', label: '常见问题' },
];

export function BottomBar() {
  const location = useLocation();
  return (
    <footer className="h-12 bg-card/60 backdrop-blur-xl border-t border-border flex items-center justify-center px-6 text-helper text-text-tertiary">
      <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
        {items.map((item, idx) => {
          const sep =
            idx > 0 ? (
              <span key={`sep-${idx}`} className="text-border-solid select-none">
                |
              </span>
            ) : null;
          if (item.kind === 'route') {
            const active = location.pathname === item.path;
            return (
              <span key={item.path} className="inline-flex items-center gap-x-6">
                {sep}
                <Link
                  to={item.path}
                  className={`transition-colors ${
                    active
                      ? 'text-primary-light font-medium'
                      : 'hover:text-text-primary'
                  }`}
                >
                  {item.label}
                </Link>
              </span>
            );
          }
          return (
            <span key={item.href} className="inline-flex items-center gap-x-6">
              {sep}
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-text-primary transition-colors"
              >
                {item.label}
              </a>
            </span>
          );
        })}
      </nav>
    </footer>
  );
}
