/**
 * 全局离线模式横幅 (v1.7.1 P2 增强,v1.8 P1-E 升级)
 *
 * 设计:
 *   - 在 App 根组件挂载,跨页面常驻
 *   - 进入时主动拉取后端 /settings/app,获得 offlineMode 真实状态
 *   - 通过 CustomEvent 'insightforge:config-changed' 监听切换(由 Settings 页 save 后派发)
 *     与 polling 兜底(60s 一次)双重保障
 *   - offlineMode=true 时在 TopBar 下方显示一条 error banner,
 *     提醒用户所有外部 API 调用将被拒绝
 *   - v1.8 P1-E 双动作:
 *     - 「重试」: 立即重新拉取 /settings/app,支持用户在 Settings 改完配置后快速联动
 *     - 「复制诊断」: 输出当前客户端/平台/时间/后端可达性等上下文,
 *       便于排查离线模式下仍调用外部 API 或 LLM 兜底失败的案例
 *   - 在 /settings 路由时静默不显示(避免与 Settings 页面内的离线模式 banner 重复)
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banner } from './Banner';
import { api } from '../lib/api';
import { useDesktopApi } from '../hooks/useDesktopApi';

export function GlobalOfflineBanner() {
  const [offlineMode, setOfflineMode] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const desktop = useDesktopApi();

  // 进入时拉一次 + 60s 兜底轮询 + 监听事件
  const refresh = useCallback(() => {
    return new Promise<void>((resolve) => {
      api
        .getAppConfig?.()
        .then((cfg) => {
          setOfflineMode(Boolean(cfg?.offlineMode));
          setLastCheckedAt(Date.now());
          resolve();
        })
        .catch(() => {
          /* 后端不可达时保留上一次状态,不更新 lastCheckedAt */
          resolve();
        });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    refresh();

    const timer = window.setInterval(() => {
      if (!cancelled) void refresh();
    }, 60_000);

    // 监听 Settings 页保存配置后的自定义事件
    const handler = () => {
      if (!cancelled) void refresh();
    };
    window.addEventListener('insightforge:config-changed', handler);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('insightforge:config-changed', handler);
    };
  }, [refresh]);

  // 在 Settings 页面内不显示,避免和卡片内的 banner 重复
  if (!offlineMode || location.pathname === '/settings') return null;

  /**
   * v1.8 P1-E: 「重试」直接重新拉取 /settings/app,处理如下场景:
   *   - 用户在 Settings 关闭离线模式后,config-changed 事件或 60s 轮询未及时刷新
   *   - 用户在另一台设备/浏览器切换了配置,本机未及时同步
   */
  const handleRetry = () => {
    void refresh();
  };

  /**
   * v1.8 P1-E: 复制诊断输出。让用户在离线模式下仍能一键把上下文发给支持,
   * 排查为什么即使开了离线模式还会出现 LLM/搜索失败。
   */
  const diagnosticText =
    `[InsightForge 离线模式诊断]\n` +
    `时间: ${new Date().toISOString()}\n` +
    `离线模式: ${offlineMode ? '已开启' : '未开启'}\n` +
    `客户端: ${desktop.isDesktop ? `Electron(${desktop.platform ?? 'unknown'})` : 'Web'}\n` +
    `后端地址: ${typeof window !== 'undefined' ? window.location.origin : 'n/a'}\n` +
    `最近检测: ${lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : '尚未检测'}\n` +
    `当前路由: ${location.pathname}\n` +
    `提示: 离线模式仅屏蔽外部 API,本地 Ollama + 历史缓存仍可使用,` +
    `若仍报 MissingLlmApiKey 请回到设置切换到 Ollama 提供方。`;

  return (
    <Banner
      tone="error"
      title="离线模式已生效"
      action={{
        label: '重试',
        onClick: handleRetry,
      }}
      copyLabel="复制诊断"
      copyText={diagnosticText}
    >
      所有外部 API 调用(大模型 / 搜索引擎)将被拒绝。
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="block mt-1 underline underline-offset-2 hover:text-text-primary text-text-tertiary"
      >
        → 前往设置关闭
      </button>
    </Banner>
  );
}