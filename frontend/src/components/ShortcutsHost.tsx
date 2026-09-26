/**
 * v1.8 P7-C: 全局快捷键宿主 - 监听 `?` / `/` 键 + 渲染说明弹窗
 *
 * - `?` 键: 任意页面(非输入框)打开 / 关闭 ShortcutsHelp Modal
 * - `/` 键: 跳到首页并聚焦想法输入框
 * - 必须挂在 <BrowserRouter> 内部(需要 useNavigate)
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { ShortcutsHelp } from './ShortcutsHelp';

export function ShortcutsHost() {
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const onShowHelp = useCallback(() => {
    setHelpOpen((v: boolean) => !v);
  }, []);

  const onFocusInput = useCallback(() => {
    // 不在首页时:先跳转,延迟聚焦
    if (location.pathname !== '/') {
      navigate('/');
    }
    // 给路由切换 + 子组件挂载一点缓冲时间,再尝试聚焦
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        'textarea, input[type="text"]:not([readonly])',
      );
      el?.focus();
    }, 50);
  }, [location.pathname, navigate]);

  // 监听来自 BottomBar 等任意位置的事件触发(v1.8 P7-C)
  useEffect(() => {
    const handler = () => setHelpOpen(true);
    window.addEventListener('insightforge:open-shortcuts-help', handler);
    return () => window.removeEventListener('insightforge:open-shortcuts-help', handler);
  }, []);

  useKeyboardShortcuts({ onShowHelp, onFocusInput });

  return <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />;
}

/** 任意组件可调用,触发 ShortcutsHost 打开说明弹窗 */
export function openShortcutsHelp(): void {
  window.dispatchEvent(new Event('insightforge:open-shortcuts-help'));
}