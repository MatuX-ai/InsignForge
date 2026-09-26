/**
 * DesktopNavigator - 订阅原生 Menu 触发的路由跳转 (v1.8 P0-A1)
 *
 * 必须在 <BrowserRouter> 内部使用,因为依赖 react-router 的 useNavigate.
 * 若运行环境不是桌面端,onNavigate 是 no-op,组件直接 return null 不影响渲染。
 *
 * 主进程 Menu 在 v1.8 新增的快捷键:
 *   Ctrl/Cmd+N   → 新建调研  (/ 路由)
 *   Ctrl/Cmd+1   → 首页
 *   Ctrl/Cmd+2   → 历史
 *   Ctrl/Cmd+3   → 监控
 *   Ctrl/Cmd+,   → 设置
 *   Ctrl/Cmd+U   → 用户中心
 *   F1           → 使用文档
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDesktopApi } from '../hooks/useDesktopApi';

export function DesktopNavigator() {
  const navigate = useNavigate();
  const desktop = useDesktopApi();

  useEffect(() => {
    if (!desktop.isDesktop) return;
    const unsub = desktop.onNavigate((path: string) => {
      // 主进程已校验 path 以 / 开头,此处直接 navigate
      navigate(path);
    });
    return unsub;
  }, [desktop, navigate]);

  return null;
}