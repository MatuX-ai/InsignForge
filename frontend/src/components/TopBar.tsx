/**
 * 顶部导航 - 深色玻璃拟态主题
 *
 * v1.8 P10-A:
 *   - 桌面端(isDesktop=true)启用全新的「无边框顶栏」分支:
 *     · 整体 -webkit-app-region: drag(顶部空白区域可拖动窗口)
 *     · 所有按钮 / 菜单 / 导航项 -webkit-app-region: no-drag(点击不被拖拽吞掉)
 *     · 窗口控制按钮(最小化 / 最大化 / 关闭)走 windowControls IPC
 *     · 复用 desktop/main.cjs 已有的应用菜单(文件 / 视图 / 设置 / 帮助),
 *       把它们做成平铺水平下拉,与主导航并排
 *   - Web 端(浏览器)保持原有布局不变,继续依赖浏览器原生窗口控制
 *
 * v2.0 改动:
 *   - BUG-04: 不再硬编码 'v1.6',改为从 vite 注入的 VITE_APP_VERSION 读取
 *   - P3-20: 横排 nav 断点从 md(768px)改为 lg(1024px),与设计文档 §2.2 一致
 *   - 鉴权入口(登录 / 用户菜单)在桌面端融入 "设置" 下拉菜单,避免顶栏拥挤
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { DropdownItem } from './Dropdown';
import { useDesktopApi } from '../hooks/useDesktopApi';
import { useCurrentUser } from '../hooks/useCurrentUser';

// 修复 BUG-04: 从 vite 注入的环境变量读取真实版本号(由 vite.config.ts 注入)。
const APP_VERSION: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_APP_VERSION ??
  '0.0.0';

/**
 * v1.8 P3-B: 主导航项(带图标,与设计文档 §2.2 对齐)
 */
const tabs: Array<{ path: string; label: string; icon: string }> = [
  { path: '/', label: '首页', icon: '🏠' },
  { path: '/discuss', label: '梳理', icon: '💬' },
  { path: '/history', label: '历史', icon: '📚' },
  { path: '/settings', label: '设置', icon: '⚙️' },
  { path: '/monitor', label: '监控', icon: '🩺' },
];

/**
 * 顶栏入口:桌面端走无边框顶栏,Web 端走原有横排 nav。
 * 通过 isDesktop 探测,避免 web 端误调用 windowControls IPC(no-op stub)。
 */
export function TopBar() {
  const desktop = useDesktopApi();
  if (desktop.isDesktop) return <FramelessTopBar />;
  return <WebTopBar />;
}

/* ============================================================
 * 桌面端 - 无边框自定义顶栏 (v1.8 P10-A)
 * ============================================================ */

/**
 * 顶栏 Logo: 直接引用统一的品牌 logo.png(与营销 website 同源),
 * 桌面端 + website + favicon 三处始终一致。
 * 同时兼容 web 部署场景:Vite 会从 public/ 复制 logo.png 到 dist 根。
 */
function LogoMark() {
  return (
    <img
      src="/logo.png"
      alt="InsightForge"
      width={22}
      height={22}
      // 品牌 logo 原始为白底透明边路 PNG, 在深色 Header 上保持原样。
      // 22×22 与 h-9 (36px) 适配: 顶栏高度 h-11 = 44px, 22px logo 与文字垂直对齐居中。
      className="h-[22px] w-[22px] object-contain"
      draggable={false}
    />
  );
}

/**
 * 窗口控制按钮 - 接受 type 与 onClick,内置 no-drag 样式。
 * SVG 图标用 currentColor,hover 效果按 type 不同:
 *   - minimize  hover 背景轻微高亮
 *   - maximize  hover 背景轻微高亮
 *   - close     hover 背景红色
 */
function WindowControlButton({
  type,
  title,
  onClick,
}: {
  type: 'minimize' | 'maximize' | 'close';
  title: string;
  onClick: () => void;
}) {
  const baseClass =
    'h-9 w-12 inline-flex items-center justify-center transition-colors select-none';
  const hoverClass =
    type === 'close'
      ? 'hover:bg-red-500 hover:text-white'
      : 'hover:bg-white/10';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      // 关键: 窗口控制按钮一定不能是 drag 区,否则点击会被吞成"拖动窗口"
      className={`${baseClass} ${hoverClass} text-text-secondary`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {type === 'minimize' && (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path d="M1 6h9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      )}
      {type === 'maximize' && (
        // 不画还原图标(简化):仅用一个方块示意,主进程会处理 toggle
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <rect
            x="1.5"
            y="1.5"
            width="8"
            height="8"
            stroke="currentColor"
            strokeWidth="1"
            rx="0.5"
          />
        </svg>
      )}
      {type === 'close' && (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
          <path
            d="M1.5 1.5l8 8M9.5 1.5l-8 8"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

/**
 * 顶栏菜单触发器按钮(文件 / 视图 / 设置 / 帮助),
 * 点击后展开下拉菜单。固定 -webkit-app-region: no-drag。
 */
function MenuTrigger({
  label,
  open,
  onClick,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`h-8 px-2.5 text-helper rounded-md transition-colors inline-flex items-center gap-1 ${
        open
          ? 'bg-white/10 text-text-primary'
          : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
      }`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {label}
    </button>
  );
}

function FramelessTopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const desktop = useDesktopApi();
  const { user, authEnabled, login, logout } = useCurrentUser();

  /* ------- 最大化状态同步 ------- */
  const [maximized, setMaximized] = useState(false);
  // 初始拉一次 + 订阅主进程推送
  useEffect(() => {
    let mounted = true;
    void desktop.windowControls.isMaximized().then((res) => {
      if (mounted && res.ok) setMaximized(res.maximized);
    });
    const off = desktop.windowControls.onMaximizeChange((next) => {
      if (mounted) setMaximized(next);
    });
    return () => {
      mounted = false;
      off();
    };
  }, [desktop]);

  const handleMinimize = useCallback(() => {
    void desktop.windowControls.minimize();
  }, [desktop]);
  const handleToggleMaximize = useCallback(() => {
    void desktop.windowControls.toggleMaximize();
  }, [desktop]);
  const handleClose = useCallback(() => {
    void desktop.windowControls.close();
  }, [desktop]);

  /* ------- 路由跳转辅助:点击菜单项后跳到对应路由并关闭下拉 ------- */
  const go = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate],
  );

  /* ------- 菜单配置(与 main.cjs setupApplicationMenu 对齐) ------- */
  const fileItems: DropdownItem[] = [
    {
      label: (
        <span className="inline-flex items-center gap-3">
          新建调研
          <span className="text-helper text-text-tertiary ml-auto">Ctrl+N</span>
        </span>
      ),
      onClick: () => go('/'),
    },
    { label: '历史记录', onClick: () => go('/history') },
    { label: '监控中心', onClick: () => go('/monitor') },
    { label: '─', onClick: () => undefined }, // 占位 - 实际不会触发(用 divider 渲染)
  ];

  const viewItems: DropdownItem[] = [
    { label: '首页', onClick: () => go('/') },
    { label: '─', onClick: () => undefined },
    // 视图菜单里的"重新加载 / 开发者工具"保留 native 行为,这里仅展示文案,
    // 点击后依赖用户按 Ctrl+R / F12 即可(native menu 仍在)。简化处理不内嵌。
    { label: '实际大小', onClick: () => undefined },
    { label: '放大', onClick: () => undefined },
    { label: '缩小', onClick: () => undefined },
    { label: '切换全屏', onClick: () => undefined },
  ];

  const settingsItems: DropdownItem[] = [
    { label: '偏好设置', onClick: () => go('/settings') },
    ...(authEnabled
      ? user
        ? [
            {
              label: `用户中心 · ${user.name}`,
              onClick: () => go('/account'),
            },
            { label: '注销', onClick: () => void logout(), tone: 'danger' as const },
          ]
        : [{ label: '登录', onClick: () => login() }]
      : []),
  ];

  const helpItems: DropdownItem[] = [
    { label: '使用文档', onClick: () => go('/readme') },
    { label: '常见问题', onClick: () => go('/faq') },
  ];

  /* ------- 自定义下拉面板(支持 divider) ------- */
  const MenuDropdown = ({
    label,
    items,
    panelTestId,
  }: {
    label: string;
    items: DropdownItem[];
    panelTestId?: string;
  }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (!open) return;
      const onDoc = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false);
      };
      window.addEventListener('mousedown', onDoc);
      window.addEventListener('keydown', onKey);
      return () => {
        window.removeEventListener('mousedown', onDoc);
        window.removeEventListener('keydown', onKey);
      };
    }, [open]);
    return (
      <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <MenuTrigger label={label} open={open} onClick={() => setOpen((v) => !v)} />
        {open && (
          <div
            role="menu"
            data-testid={panelTestId}
            className="absolute left-0 top-full mt-1 min-w-[200px] bg-card-solid/95 backdrop-blur-2xl border border-border rounded-lg shadow-glass z-30 overflow-hidden if-panel-rise"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {items.map((it, i) => {
              if (it.label === '─') {
                return <div key={`div-${i}`} className="my-1 border-t border-border" />;
              }
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                  className={`w-full text-left px-4 py-2 text-body flex items-center justify-between gap-3 transition-colors ${
                    it.tone === 'danger'
                      ? 'text-red-400 hover:bg-red-500/10'
                      : 'text-text-primary hover:bg-hover-bg'
                  }`}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <header
      className="h-11 flex items-center px-3 sm:px-4 select-none border-b border-border"
      style={{
        background: '#1a1f2e',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* ---------- 左侧:Logo + 应用名 + 水平菜单 ---------- */}
      <div
        className="flex items-center gap-1.5 min-w-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Link
          to="/"
          className="flex items-center gap-2 mr-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onDoubleClick={handleToggleMaximize}
        >
          <LogoMark />
          {/* v1.8 P10-A: 应用名渐变与营销 website .gradient-text 保持一致
           *   from-primary-light (#818CF8) -> via-accent (#A78BFA) -> to-cyan (#22D3EE)
           * 不依赖 tailwind .gradient-text 是为了在顶栏 inline style 中独立控制。 */}
          <span
            className="font-semibold text-[15px] tracking-wide"
            style={{
              background:
                'linear-gradient(90deg, #818CF8 0%, #A78BFA 50%, #22D3EE 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            InsightForge
          </span>
        </Link>

        {/* 水平菜单:文件 / 视图 / 设置 / 帮助 */}
        <div
          className="hidden md:flex items-center gap-0.5 ml-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <MenuDropdown label="文件" items={fileItems} />
          <MenuDropdown label="视图" items={viewItems} />
          <MenuDropdown label="设置" items={settingsItems} />
          <MenuDropdown label="帮助" items={helpItems} />
        </div>
      </div>

      {/* ---------- 中部:主导航(首页 / 梳理 / 历史 / 设置 / 监控) ---------- */}
      <nav
        className="hidden lg:flex items-center gap-1 mx-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-helper transition-colors ${
                active
                  ? 'bg-primary/20 text-primary-light font-medium'
                  : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <span aria-hidden>{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ---------- 中部拖拽占位:让左右两侧内容可被推到两端 ---------- */}
      <div className="flex-1 h-full" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* ---------- 右侧:版本信息 + 窗口控制按钮 ---------- */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span
          className="text-helper text-text-tertiary hidden md:inline"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          v{APP_VERSION} · 个人版
        </span>
        <WindowControlButton type="minimize" title="最小化" onClick={handleMinimize} />
        <WindowControlButton
          type="maximize"
          title={maximized ? '还原' : '最大化'}
          onClick={handleToggleMaximize}
        />
        <WindowControlButton type="close" title="关闭" onClick={handleClose} />
      </div>
    </header>
  );
}

/* ============================================================
 * Web 端 - 保留 v2.0 既有实现
 * ============================================================ */

function WebTopBar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { user, authEnabled, login, logout } = useCurrentUser();

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

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  useEffect(() => {
    setOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="h-14 bg-card/80 backdrop-blur-xl border-b border-border flex items-center px-4 sm:px-6 sticky top-0 z-20 shadow-glass">
      <Link
        to="/"
        className="text-section text-text-primary font-semibold mr-6 sm:mr-8 bg-gradient-to-r from-primary-light to-accent bg-clip-text text-transparent"
      >
        InsightForge
      </Link>

      <nav className="hidden lg:flex gap-6">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`text-body transition-all duration-200 relative flex items-center gap-1 ${
                active
                  ? 'text-primary-light font-medium'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <span aria-hidden>{tab.icon}</span>
              <span>{tab.label}</span>
              {active && (
                <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-accent rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden lg:block text-helper text-text-tertiary">
          v{APP_VERSION} · 个人版
        </div>

        {authEnabled && (
          <div ref={userMenuRef} className="relative">
            {user ? (
              <>
                <button
                  type="button"
                  aria-label="用户菜单"
                  aria-expanded={userMenuOpen}
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-2 h-9 px-2 rounded-lg hover:bg-hover-bg border border-border transition-colors"
                >
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.name}
                      className="w-6 h-6 rounded-full object-cover"
                    />
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-primary/30 text-primary-light text-helper flex items-center justify-center">
                      {user.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="text-helper text-text-primary hidden sm:inline">
                    {user.name}
                  </span>
                </button>
                {userMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-2 w-56 bg-card-solid/95 backdrop-blur-2xl border border-border rounded-lg shadow-glass z-30 overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-border">
                      <div className="text-body text-text-primary truncate">
                        {user.name}
                      </div>
                      <div className="text-helper text-text-secondary truncate">
                        {user.email}
                      </div>
                      <div className="mt-2 text-helper text-text-secondary">
                        计划:{' '}
                        <span className="text-primary-light font-medium">
                          {user.plan_type}
                        </span>
                      </div>
                      <div className="mt-1 text-helper text-text-secondary">
                        今日剩余:{' '}
                        <span className="text-primary-light font-medium">
                          {user.quota.remaining}
                        </span>{' '}
                        / {user.quota.limit}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void logout()}
                      className="block w-full text-left px-4 py-3 text-body text-text-primary hover:bg-hover-bg transition-colors"
                    >
                      注销
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={login}
                className="h-9 px-3 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary-light text-helper border border-primary/30 transition-colors"
              >
                登录
              </button>
            )}
          </div>
        )}

        <div ref={menuRef} className="lg:hidden relative">
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
              aria-orientation="vertical"
              className="absolute right-0 top-full mt-2 w-48 bg-card-solid/95 backdrop-blur-2xl border border-border rounded-lg shadow-glass z-30 overflow-hidden if-panel-rise"
            >
              {tabs.map((tab) => {
                const active = location.pathname === tab.path;
                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    role="menuitem"
                    className={`flex items-center gap-2 px-4 py-3 text-body transition-colors ${
                      active
                        ? 'text-primary-light bg-primary/10 font-medium'
                        : 'text-text-primary hover:bg-hover-bg'
                    }`}
                  >
                    <span aria-hidden>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </Link>
                );
              })}
              <div className="px-4 py-2 text-helper text-text-tertiary border-t border-border">
                v{APP_VERSION} · 个人版
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// DropdownItem 类型当前用于自定义 MenuDropdown 中"─" 占位渲染(divider 渲染分支)。
// 保留 import 仅作类型引用。