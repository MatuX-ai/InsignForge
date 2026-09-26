/**
 * 设置页 - 按前端设计文档 §3.4
 * LLM Provider 配置 + 搜索引擎配置 + 代理池配置(FR-08) + 离线模式(FR-18)
 *
 * Provider 下拉选项与默认模型均使用前端 lib/llmProviders.ts 的注册表驱动,
 * 在该注册表中添加国产大模型即可在此页自动露出。
 *
 * 注意:API Key 保存后会同步写入后端内存与 .env 文件,无需重启服务。
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Container } from '../components/Container';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { api } from '../lib/api';
import {
  LLM_PROVIDERS,
  defaultModelFor,
  getLlmProvider,
} from '../lib/llmProviders';
import type { AppSettings, LlmProvider, LlmStatus } from '../types';

// 修复 BUG-05: 不再硬编码 'deepseek-v4-pro',改为从注册表读取默认值。
// 当 llmProviders.ts 中 deepseek 的 defaultModel 字段更新时,这里会自动跟随。
const DEFAULT: AppSettings = {
  llmProvider: 'deepseek',
  llmModel: defaultModelFor('deepseek'),
  searchProvider: 'openserp',
  searchUrl: 'http://localhost:8080',
  showApiKey: false,
};

/**
 * 免配置冷启动默认会调用的内置搜索源(v1.7)
 *
 * 与 backend/src/services/search/Aggregator.ts 中实际调用的 searchXxx 一致。
 * 微博/小红书为骨架源,匿名下 100% 风控,此处不展示避免误导用户。
 *
 * AI 助理是另外一层的搜索能力——讨论 AI 会自主调用
 *   @insightforge/mcp-server 暴露的 market_research / search_demand /
 *   competitor_analysis 工具(后端 DiscussionResearch.ts),即使上方 5 个
 *   外部源全部不可达, AI 助理也能基于内置示例数据给出回答。
 *
 * 图标实现:
 *   - 不引入额外静态资源;用 inline monogram徽标表达品牌。
 *   - 每个 Logo 是 平台官方品牌色背景 + 品牌标识字符(G/Y/R/知/J/AI)的圆角小方块。
 *   - 品牌色选自各平台公开主色;改色请同步 docs/02-前端设计文档.md。
 */
const BUILTIN_SEARCH_SOURCES: ReadonlyArray<{
  id: string;
  label: string;
  /** 单字符徽标文字(HN 用 Y、知乎用 知、掘金用 J、AI 助理用 AI) */
  logoText: string;
  /** 平台官方主色,直接作为徽标背景 */
  logoBg: string;
  /** 徽标文字颜色;与背景对比度需达到 WCAG AA(2个深色品牌需用白字) */
  logoFg: string;
  typeLabel: string;
  /** AI 助理是语义级检索,与外部源不同层;标记后用虚线边框表达差异 */
  aiAgent?: boolean;
}> = [
  { id: 'google',     label: 'Google',      logoText: 'G',  logoBg: '#4285F4', logoFg: '#FFFFFF', typeLabel: '搜索' },
  { id: 'hackernews', label: 'Hacker News', logoText: 'Y',  logoBg: '#FF6600', logoFg: '#FFFFFF', typeLabel: '论坛' },
  { id: 'reddit',     label: 'Reddit',      logoText: 'R',  logoBg: '#FF4500', logoFg: '#FFFFFF', typeLabel: '社交' },
  { id: 'zhihu',      label: '知乎',        logoText: '知', logoBg: '#0084FF', logoFg: '#FFFFFF', typeLabel: '论坛' },
  { id: 'juejin',     label: '掘金',        logoText: 'J',  logoBg: '#1E80FF', logoFg: '#FFFFFF', typeLabel: '论坛' },
  // AI 助理自身是一个"语义检索"渠道,讨论梳理时会自主调用 MCP 工具
  { id: 'ai-agent',   label: 'AI 助理',     logoText: 'AI', logoBg: '#8B5CF6', logoFg: '#FFFFFF', typeLabel: '智能体', aiAgent: true },
];

export function Settings() {
  const [settings, setSettings] = useLocalStorage<AppSettings>('settings', DEFAULT);
  const [apiKey, setApiKey] = useLocalStorage<string>('llm_api_key', '');
  const [serpApiKey, setSerpApiKey] = useLocalStorage<string>('serp_api_key', '');
  // FR-08: 代理池配置(运行时透传到后端 .env / 进程内存,无需重启)
  const [proxyEnabled, setProxyEnabled] = useLocalStorage<boolean>('proxy_enabled', false);
  const [proxyUrl, setProxyUrl] = useLocalStorage<string>('proxy_url', '');
  // FR-18: 离线模式开关 - 仅用本地 Ollama + 本地缓存,所有外部 API 调用被禁用
  const [offlineMode, setOfflineMode] = useLocalStorage<boolean>('offline_mode', false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** v1.8 P1-A: 保存中 loading 状态 - 禁用按钮 + 锁定表单防重复提交 */
  const [saving, setSaving] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  /** 最近一次成功保存的快照,用于检测"未保存修改" */
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({
    settings,
    apiKey,
    serpApiKey,
    proxyEnabled,
    proxyUrl,
    offlineMode,
  }));

  /**
   * 与快照对比,判断用户是否改动过任意表单字段。
   * 注意 showApiKey 不参与对比(只影响 UI,不参与保存)。
   */
  const isDirty = useMemo(() => {
    type Persistable = Omit<AppSettings, 'showApiKey'>;
    const stripUi = (s: AppSettings): Persistable => ({
      llmProvider: s.llmProvider,
      llmModel: s.llmModel,
      searchProvider: s.searchProvider,
      searchUrl: s.searchUrl,
      serpApiKey: s.serpApiKey,
    });
    const cur = JSON.stringify({
      settings: stripUi(settings),
      apiKey,
      serpApiKey,
      proxyEnabled,
      proxyUrl,
      offlineMode,
    });
    const snap = JSON.stringify({
      settings: stripUi(savedSnapshot.settings),
      apiKey: savedSnapshot.apiKey,
      serpApiKey: savedSnapshot.serpApiKey,
      proxyEnabled: savedSnapshot.proxyEnabled,
      proxyUrl: savedSnapshot.proxyUrl,
      offlineMode: savedSnapshot.offlineMode,
    });
    return cur !== snap;
  }, [settings, apiKey, serpApiKey, proxyEnabled, proxyUrl, offlineMode, savedSnapshot]);

  /** 还原快照,丢弃当前修改 */
  const revert = () => {
    setSettings(savedSnapshot.settings);
    setApiKey(savedSnapshot.apiKey);
    setSerpApiKey(savedSnapshot.serpApiKey);
    setProxyEnabled(savedSnapshot.proxyEnabled);
    setProxyUrl(savedSnapshot.proxyUrl);
    setOfflineMode(savedSnapshot.offlineMode);
  };

  // 进入页面拉取后端 LLM 状态 + 全局应用配置(FR-08/FR-18)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, appCfg] = await Promise.all([
          api.getLlmStatus(),
          api.getAppConfig?.().catch(() => null),
        ]);
        if (!cancelled) {
          setLlmStatus(s);
          // 以后端实际生效的 provider/model 回填表单(后端是权威来源,
          // 避免 localStorage 与 .env 不一致导致看不到真实配置)
          setSettings((prev) => ({
            ...prev,
            llmProvider: s.provider,
            llmModel: s.model || prev.llmModel,
          }));
          // FR-08/FR-18: 同步回填代理 / 离线模式(后端权威优先)
          if (appCfg) {
            setProxyEnabled(appCfg.proxyEnabled);
            if (appCfg.proxyUrl) setProxyUrl(appCfg.proxyUrl);
            setOfflineMode(appCfg.offlineMode);
          }
          setLoadingStatus(false);
        }
      } catch (err) {
        if (!cancelled) {
          setSaveError(err instanceof Error ? err.message : String(err));
          setLoadingStatus(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 保存:同时写入 localStorage 与后端
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // 1) 同步 provider/model 到后端,保证【当前生效配置】与表单一致
      //    (仅当与后端现有值不同才调用,避免无谓请求)
      const backendProvider = llmStatus?.provider;
      const backendModel = llmStatus?.model;
      if (
        !llmStatus ||
        settings.llmProvider !== backendProvider ||
        settings.llmModel !== backendModel
      ) {
        const cfgRes = await api.updateLlmConfig({
          provider: settings.llmProvider,
          model: settings.llmModel,
        });
        if (!cfgRes.ok) throw new Error(cfgRes.message ?? 'LLM 配置保存失败');
      }

      // 2) 仅在用户填了 key 时才上报到后端(避免空字符串误覆盖)
      if (apiKey.trim().length > 0) {
        const res = await api.updateLlmApiKey(apiKey.trim());
        if (!res.ok) throw new Error(res.message ?? '保存失败');
      }

      // 3) 重新拉取后端状态,让【当前生效配置】反映最新保存结果
      const s = await api.getLlmStatus();
      setLlmStatus(s);

      // 4) 搜索配置(provider + SerpAPI Key):始终同步,让"更精准数据"的配置真实生效
      const searchRes = await api.updateSearchConfig({
        provider: settings.searchProvider,
        apiKey: serpApiKey.trim(),
      });
      if (!searchRes.ok) throw new Error(searchRes.message ?? '搜索配置保存失败');

      // 5) FR-08 代理池配置 + FR-18 离线模式:通过通用 updateAppConfig 写入后端
      //    后端在收到 offlineMode=true 时会拒绝任何外部 API 调用。
      //    接口失败不影响前面 LLM/搜索配置已生效(局部降级)。
      try {
        await api.updateAppConfig?.({
          proxyEnabled,
          proxyUrl: proxyUrl.trim(),
          offlineMode,
        });
      } catch {
        // 兜底:如果后端尚未支持该接口,不影响核心保存
      }

      // 保存成功后更新快照,isDirty 随即恢复为 false
      setSavedSnapshot({
        settings,
        apiKey,
        serpApiKey,
        proxyEnabled,
        proxyUrl,
        offlineMode,
      });
      // v1.7.1 P2: 通知全局监听器(GlobalOfflineBanner 等)刷新状态
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('insightforge:config-changed'));
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      // v1.8 P1-A: 无论成功失败都解除 saving,失败时保存按钮回到 disabled 但可重试
      setSaving(false);
    }
  };

  // 离线模式已生效时,在「离线模式」卡片顶部显示高优先级提醒,避免用户以为"开着但没用"
  // v1.8 P1-E: 增加「复制诊断」一键导出上下文 + 「滚动到开关」快速操作
  const offlineModeNotice = offlineMode ? (
    <Banner
      tone="error"
      title="离线模式已生效"
      action={{
        label: '前往关闭 →',
        onClick: () => scrollToOfflineSwitch(),
      }}
      copyLabel="复制诊断"
      copyText={
        `[InsightForge 离线模式诊断]\n` +
        `时间: ${new Date().toISOString()}\n` +
        `离线模式: 已开启(用户切换)\n` +
        `LLM Provider: ${settings.llmProvider}\n` +
        `LLM Model: ${settings.llmModel}\n` +
        `代理: ${proxyEnabled ? `${proxyUrl}` : '未开启'}\n` +
        `后端地址: ${typeof window !== 'undefined' ? window.location.origin : 'n/a'}\n` +
        `提示: 离线模式会拒绝外部 API,只有本地 Ollama 与本地缓存可用。\n` +
        `若希望恢复外部 API 调用,请在此页关闭离线模式并保存。`
      }
    >
      所有外部 API 调用(大模型 / 搜索引擎)将被拒绝,
      只会使用本地 Ollama 与本地历史缓存。市场调研质量会显著下降,需要时回到此处关闭。
    </Banner>
  ) : null;

  /**
   * 离线模式下 LLM 兜底校验:
   *   - 如果当前 LLM provider 是需要外部 API 的(非 Ollama),
   *     在离线时调用会报 MissingLlmApiKeyError / OFFLINE_MODE_BLOCKED。
   *   - 在「离线模式」卡片下方显示黄色警告 + 一键切换建议。
   *   - v1.8 P1-E: 加「去切换」action +「复制诊断」双动作
   */
  const offlineLlmWarning =
    offlineMode && settings.llmProvider !== 'ollama' ? (
      <Banner
        tone="warning"
        title="当前 LLM 不可用,请切换到 Ollama"
        action={{
          label: '去切换 →',
          onClick: () => scrollToLlmProvider(),
        }}
        copyLabel="复制诊断"
        copyText={
          `[InsightForge LLM 诊断]\n` +
          `离线模式: 已开启\n` +
          `当前 Provider: ${settings.llmProvider}\n` +
          `当前 Model: ${settings.llmModel}\n` +
          `问题: 离线模式下 ${settings.llmProvider} 的外部调用被后端拒绝\n` +
          `建议: 切换到 Ollama(本地无需 Key),或关闭离线模式\n` +
          `时间: ${new Date().toISOString()}`
        }
      >
        离线模式下 <b>{getLlmProvider(settings.llmProvider)?.label ?? settings.llmProvider}</b> 的外部调用将被拒绝。
        请先在「大模型 API」区块切换到 <b>Ollama</b>(本地无需 Key),然后保存设置。
      </Banner>
    ) : null;

  /**
   * v1.8 P1-E: 平滑滚动到「离线模式」开关卡片,并自动聚焦开关,
   * 让 action 按钮点击后有明确的视觉反馈。
   */
  const scrollToOfflineSwitch = () => {
    const el = document.getElementById('settings-offline-toggle');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      const input = el.querySelector<HTMLInputElement>(
        'input[type="checkbox"], button[role="switch"]',
      );
      input?.focus();
    }, 350);
  };

  /**
   * v1.8 P1-E: 滚动到「大模型 API」区块 + 聚焦 Provider 下拉
   */
  const scrollToLlmProvider = () => {
    const el = document.getElementById('settings-llm-provider');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      const select = el.querySelector<HTMLSelectElement>('select');
      select?.focus();
    }, 350);
  };

  /**
   * 代理 URL 格式校验 (v1.8 P1-A):
   *   - http / https / socks5 / socks5h 都允许
   *   - 后端 proxy-agent 统一处理代理协议,这里仅做基本格式校验
   *   - 校验失败时在输入框下方显示红色提示,并阻止保存按钮变 primary
   */
  const proxyUrlError = useMemo(() => {
    if (!proxyEnabled) return null;
    const url = proxyUrl.trim();
    if (!url) return '请填写代理地址';
    // v1.8 P1-A: 之前只允许 http/https,与 placeholder "socks5://" 提示冲突
    if (!/^(https?|socks5?):\/\/[\w.-]+:\d{2,5}$/.test(url)) {
      return '格式错误:应为 http://host:port / https://host:port / socks5://host:port 之一';
    }
    return null;
  }, [proxyEnabled, proxyUrl]);
  const isFormInvalid = Boolean(proxyUrlError);

  // 离开/刷新前提示未保存修改
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  return (
    <Container size="md">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-title text-text-primary">设置</h1>
        {isDirty && (
          <button
            type="button"
            onClick={revert}
            className="text-helper text-text-secondary hover:text-primary underline-offset-4 hover:underline transition-colors"
          >
            放弃修改
          </button>
        )}
      </div>

      {isDirty && (
        <div className="mb-6">
          <Banner tone="warning" title="有未保存的修改">
            下方表单已变动,请点击底部“保存设置”同步到后端。
          </Banner>
        </div>
      )}

      <Card title="大模型 API" id="settings-llm-provider">
        <div className="space-y-4">
          <div>
            <label className="text-helper text-text-secondary block mb-1">
              Provider
            </label>
            <select
              value={settings.llmProvider}
              onChange={(e) => {
                const nextProvider = e.target.value as LlmProvider;
                // 切换 Provider 时:若 model 仍为上一个 provider 的默认值,
                // 自动切换到新 provider 的默认 model,避免出现"provider=glm, model=deepseek-chat"这种不一致状态
                const currentProviderMeta = getLlmProvider(settings.llmProvider);
                const isCurrentModelStillDefault =
                  currentProviderMeta?.suggestedModels.includes(settings.llmModel) ?? false;
                const newModel =
                  isCurrentModelStillDefault || !settings.llmModel
                    ? defaultModelFor(nextProvider)
                    : settings.llmModel;
                setSettings({
                  ...settings,
                  llmProvider: nextProvider,
                  llmModel: newModel,
                });
              }}
              className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.brand ? ` · ${p.brand}` : ''}
                  {!p.requiresKey ? ' · 本地无需 Key' : ''}
                </option>
              ))}
            </select>
            {/* 当前 provider 的一句话简介 + 提供 Key 申请连接 */}
            <ProviderHint provider={settings.llmProvider} />
          </div>

          <div>
            <label className="text-helper text-text-secondary block mb-1">
              Model
            </label>
            <input
              type="text"
              list="llm-suggested-models"
              value={settings.llmModel}
              onChange={(e) =>
                setSettings({ ...settings, llmModel: e.target.value })
              }
              // 修复 P1-03: placeholder 不再引用已停用的 'deepseek-chat',
              // 改为用注册表的第一个推荐模型作为示例,自动跟随 provider 切换
              placeholder={`例如 ${(getLlmProvider(settings.llmProvider)?.suggestedModels ?? [])[0] ?? 'model-name'}`}
              className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            />
            {/* 当前 provider 的推荐模型 datalist,支持 input 自动补全 */}
            <datalist id="llm-suggested-models">
              {(getLlmProvider(settings.llmProvider)?.suggestedModels ?? []).map(
                (m) => (
                  <option key={m} value={m} />
                )
              )}
            </datalist>
            <div className="text-helper text-text-secondary mt-1">
              可从下拉直接选取推荐模型,也可手动输入自定义模型名
            </div>
          </div>

          <div>
            <label className="text-helper text-text-secondary block mb-1">
              API Key
              {getLlmProvider(settings.llmProvider)?.keyUrl && (
                <a
                  href={getLlmProvider(settings.llmProvider)!.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  去获取 →
                </a>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type={settings.showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  getLlmProvider(settings.llmProvider)?.requiresKey
                    ? 'sk-...'
                    : '本地 Ollama 无需 Key'
                }
                className="flex-1 h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() =>
                  setSettings({ ...settings, showApiKey: !settings.showApiKey })
                }
                className="text-helper text-text-secondary hover:text-primary"
              >
                {settings.showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
            <div className="text-helper text-text-secondary mt-1">
              密钥会同步到后端内存与 .env 文件,保存后无需重启服务即可生效
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-helper text-text-secondary">状态:</span>
            {loadingStatus ? (
              <span className="text-helper text-text-secondary">检测中...</span>
            ) : (() => {
              const meta = llmStatus ? getLlmProvider(llmStatus.provider) : null;
              const noKeyNeeded = meta ? !meta.requiresKey : false;
              if (noKeyNeeded) {
                return (
                  <span className="text-success text-helper">
                    ✅ 本地 Ollama,无需 Key
                  </span>
                );
              }
              if (llmStatus?.hasApiKey) {
                return (
                  <span className="text-success text-helper">
                    ✅ 已配置
                    {llmStatus.runtimeOverride && '(本次会话已更新)'}
                  </span>
                );
              }
              return (
                <span className="text-warning text-helper">
                  ⚠ 未配置,无法调用 LLM
                </span>
              );
            })()}
          </div>

          {!loadingStatus && llmStatus && (llmStatus.hasApiKey || !getLlmProvider(llmStatus.provider)?.requiresKey) && (
            <>
              {/* 当前生效配置:展示后端实际生效的 provider/model/baseUrl/key 快照,
                  用户在上方填表 + 点击保存后,这里会立即反映新值。
                  未配置 API Key 且当前 Provider 需要 Key 时整张卡片隐藏,
                  避免出现"半个生效配置"的误导。 */}
              <div className="rounded-lg border border-border bg-card-solid/40 p-4 space-y-1.5">
                <div className="text-helper text-text-secondary font-medium mb-2">
                  当前生效配置
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-helper text-text-secondary shrink-0">
                    Provider
                  </span>
                  <span className="text-body text-text-primary">
                    {getLlmProvider(llmStatus.provider)?.label ?? llmStatus.provider}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-helper text-text-secondary shrink-0">
                    Model
                  </span>
                  <span className="text-body text-text-primary">{llmStatus.model}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-helper text-text-secondary shrink-0">
                    Base URL
                  </span>
                  <span className="text-body text-text-primary break-all text-right">
                    {llmStatus.baseUrl}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-helper text-text-secondary shrink-0">
                    API Key
                  </span>
                  <span className="text-body text-text-primary">
                    {(() => {
                      const meta = getLlmProvider(llmStatus.provider);
                      if (meta && !meta.requiresKey) {
                        return '本地无需 Key';
                      }
                      if (llmStatus.hasApiKey) return llmStatus.apiKeyMask;
                      // 未配置 key 时给出可执行的引导,而不是干巴巴的"未配置"
                      return (
                        <span className="text-warning">
                          未配置,请在上方填写后保存
                        </span>
                      );
                    })()}
                  </span>
                </div>
              </div>
            </>
          )}

          {saveError && (
            <Banner tone="error" title="保存到后端失败">
              {saveError}
            </Banner>
          )}
        </div>
      </Card>

      <div className="my-6">
        <Card title="搜索引擎">
          <div className="space-y-4">
            {/* 免配置冷启动说明 */}
            <div className="rounded-lg border border-border bg-card-solid/40 p-4 text-helper text-text-secondary leading-relaxed">
              默认<b className="text-text-primary">免配置冷启动</b>:未配置任何搜索源时,讨论调研会使用内置示例数据兜底,开箱即用。
              <br />
              需要<b className="text-text-primary">更精准的实时市场数据</b>时,可自行
              <a
                href="https://serpapi.com/manage-api-key"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                申请 SerpAPI Key
              </a>
              并填入下方;或自托管
              <code className="mx-1 px-1 bg-hover-bg rounded text-primary-light">
                OpenSerp
              </code>
              服务后选择对应 Provider。
            </div>

            {/* 免配置可用搜索源:品牌色 monogram 徽标一排展示
                不用 emoji/抽象色块,以官方品牌色 + 单字符表达 Logo。
                Logo 本身是一个小尺寸的圆角方块(类似浏览器收藏夹 favicon), */}
            <div>
              <div className="text-helper text-text-secondary mb-2">
                开箱即用的内置搜索源
              </div>
              <div className="flex flex-wrap gap-2">
                {BUILTIN_SEARCH_SOURCES.map((src) => (
                  <div
                    key={src.id}
                    title={
                      src.aiAgent
                        ? `${src.label} · ${src.typeLabel} · 讨论 AI 会自主调用 MCP 工具检索,免配置可用`
                        : `${src.label} · ${src.typeLabel} · 免配置可用`
                    }
                    className={
                      src.aiAgent
                        // AI 助理是"语义检索"层,用紫色实线边框 + 紫色徽标表达身份,
                        // 不用虚线框(会让用户误以为未启用)
                        ? 'flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-violet-500/50 bg-card-solid/30 text-helper'
                        : 'flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-card-solid/30 text-helper'
                    }
                  >
                    {/* 品牌色 monogram 徽标:平台官方主色背景 + 品牌标识字符 */}
                    <span
                      aria-hidden
                      className="inline-flex items-center justify-center w-5 h-5 rounded font-bold leading-none"
                      style={{ background: src.logoBg, color: src.logoFg, fontSize: src.logoText.length > 1 ? 9 : 11 }}
                    >
                      {src.logoText}
                    </span>
                    <span className="text-text-primary font-medium">{src.label}</span>
                    <span className="text-text-secondary">{src.typeLabel}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-helper text-text-secondary block mb-1">
                Provider
              </label>
              <select
                value={settings.searchProvider}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    searchProvider: e.target.value as AppSettings['searchProvider'],
                  })
                }
                className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              >
                <option value="openserp">OpenSerp</option>
                <option value="serpapi">SerpAPI</option>
              </select>
              <div className="text-helper text-text-secondary mt-1">
                OpenSerp = 自托管(默认); SerpAPI = 云服务(需自行申请 Key)
              </div>
            </div>

            {settings.searchProvider === 'openserp' ? (
              <div>
                <label className="text-helper text-text-secondary block mb-1">
                  服务地址
                </label>
                <input
                  type="text"
                  value={settings.searchUrl}
                  onChange={(e) =>
                    setSettings({ ...settings, searchUrl: e.target.value })
                  }
                  className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                />
              </div>
            ) : (
              <div>
                <label className="text-helper text-text-secondary block mb-1">
                  SerpAPI Key
                </label>
                <input
                  type="password"
                  value={serpApiKey}
                  onChange={(e) => setSerpApiKey(e.target.value)}
                  placeholder="serpapi key..."
                  className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                />
                <div className="text-helper text-text-secondary mt-1">
                  保存后立即生效,市场调研将使用真实搜索结果
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-helper text-text-secondary">状态:</span>
              <span className="text-text-secondary text-helper">
                由后端服务决定是否可达
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* FR-08: 代理池配置(应对反爬) */}
      <div className="my-6">
        <Card title="网络与代理 (FR-08)">
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card-solid/40 p-4 text-helper text-text-secondary leading-relaxed">
              <b className="text-text-primary">代理池</b>用于绕过反爬限制。
              未启用时,所有请求会直接从本机发出。
              启用后,所有外部 HTTP 请求将通过下方配置的代理转发(支持 HTTP / SOCKS5)。
            </div>
            <div className="flex items-center gap-3">
              <input
                id="proxy-enabled"
                type="checkbox"
                checked={proxyEnabled}
                onChange={(e) => setProxyEnabled(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="proxy-enabled" className="text-body text-text-primary cursor-pointer">
                启用网络代理
              </label>
            </div>
            <div>
              <label className="text-helper text-text-secondary block mb-1">
                代理地址
              </label>
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                disabled={!proxyEnabled}
                placeholder="http://127.0.0.1:7890  或  socks5://127.0.0.1:1080"
                aria-invalid={proxyUrlError ? 'true' : 'false'}
                className={
                  proxyUrlError
                    ? 'w-full h-10 px-3 border border-error rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-error focus:ring-2 focus:ring-error/20 disabled:opacity-50 disabled:cursor-not-allowed'
                    : 'w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed'
                }
              />
              {proxyUrlError ? (
                <div className="text-helper text-error mt-1" role="alert">
                  {proxyUrlError}
                </div>
              ) : (
                <div className="text-helper text-text-secondary mt-1">
                  保存后立即生效。格式:协议://主机:端口。可向代理服务商获取。
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* FR-18: 离线模式开关 */}
      {/* v1.8 P1-E: id=settings-offline-toggle 供 Banner action 滚动锚点 */}
      <div id="settings-offline-toggle" className="my-6">
        <Card title="离线模式 (FR-18)">
          <div className="space-y-4">
            {offlineModeNotice}
            {offlineLlmWarning}
            <div className="rounded-lg border border-border bg-card-solid/40 p-4 text-helper text-text-secondary leading-relaxed">
              <b className="text-text-primary">开启离线模式</b>后,后端会拒绝所有外部 API 调用,
              仅使用本地 Ollama + 本地历史缓存。这是为了对<b className="text-text-primary">数据敏感</b>的场景准备的,
              开启时报告质量会显著下降,请权衡使用。
            </div>
            <div className="flex items-center gap-3">
              <input
                id="offline-mode"
                type="checkbox"
                checked={offlineMode}
                onChange={(e) => setOfflineMode(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="offline-mode" className="text-body text-text-primary cursor-pointer">
                启用离线模式(仅本地模型 + 本地缓存)
              </label>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          onClick={() => void save()}
          disabled={loadingStatus || saving || !isDirty || isFormInvalid}
          loading={saving}
          variant={isDirty && !isFormInvalid && !saving ? 'primary' : 'outline'}
          title={
            isFormInvalid
              ? '表单存在错误,请检查后再保存'
              : !isDirty
                  ? '当前无变化,无需保存'
                  : saving
                    ? '正在保存到后端...'
                    : '保存到后端'
          }
        >
          {saved ? '已保存' : saving ? '保存中...' : isFormInvalid ? '表单有误' : isDirty ? '保存设置' : '无需保存'}
        </Button>
      </div>

      <div className="mt-8 text-helper text-text-secondary">
        注:前端保存的 API Key 会同步写入后端进程与
        <code className="mx-1 px-1 bg-hover-bg rounded text-primary-light">.env</code>
        文件,后续 LLM 调用将立即使用新 Key,无需重启服务。
      </div>
    </Container>
  );
}

/**
 * Provider 下拉下面的 一句话描述 + 申请 Key 提示
 * 依赖 LLM_PROVIDERS 注册表;provider 未知时静默不渲染
 */
function ProviderHint({ provider }: { provider: LlmProvider }) {
  const meta = getLlmProvider(provider);
  if (!meta) return null;
  return (
    <div className="text-helper text-text-secondary mt-1">
      {meta.description}
      {meta.keyUrl && (
        <>
          {' · '}
          <a
            href={meta.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            申请 API Key →
          </a>
        </>
      )}
    </div>
  );
}
