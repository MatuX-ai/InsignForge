/**
 * 全局离线模式横幅 (v1.7.1 P2 增强)
 *
 * 设计:
 *   - 在 App 根组件挂载,跨页面常驻
 *   - 进入时主动拉取后端 /settings/app,获得 offlineMode 真实状态
 *   - 通过 CustomEvent 'insightforge:config-changed' 监听切换(由 Settings 页 save 后派发)
 *     与 polling 兜底(60s 一次)双重保障
 *   - offlineMode=true 时在 TopBar 下方显示一条 error banner,
 *     提醒用户所有外部 API 调用将被拒绝
 *   - 提供"去设置"快捷按钮
 *   - 在 /settings 路由时静默不显示(避免与 Settings 页面内的离线模式 banner 重复)
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export function GlobalOfflineBanner() {
  const [offlineMode, setOfflineMode] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // 进入时拉一次 + 60s 兜底轮询 + 监听事件
  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      api
        .getAppConfig?.()
        .then((cfg) => {
          if (!cancelled) setOfflineMode(Boolean(cfg?.offlineMode));
        })
        .catch(() => {
          /* 后端不可达时保留上一次状态 */
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 60_000);

    // 监听 Settings 页保存配置后的自定义事件
    const handler = () => refresh();
    window.addEventListener('insightforge:config-changed', handler);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('insightforge:config-changed', handler);
    };
  }, []);

  // 在 Settings 页面内不显示,避免和卡片内的 banner 重复
  if (!offlineMode || location.pathname === '/settings') return null;

  return (
    <div
      role="alert"
      className="bg-red-500/10 border-b border-red-500/30 text-red-400 backdrop-blur-sm"
    >
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between gap-3 text-helper">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="font-bold">⚠</span>
          <span className="truncate">
            <b className="text-red-300">离线模式已生效</b>
            <span className="hidden md:inline">
              {' '}· 所有外部 API 调用(大模型 / 搜索引擎)将被拒绝
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="shrink-0 underline-offset-2 hover:underline font-medium"
        >
          前往设置关闭 →
        </button>
      </div>
    </div>
  );
}