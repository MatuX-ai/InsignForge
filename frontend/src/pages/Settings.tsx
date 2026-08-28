/**
 * 设置页 - 按前端设计文档 §3.4
 * LLM Provider 配置 + 搜索引擎配置
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
import { useLocalStorage } from '../hooks/useLocalStorage';
import { api } from '../lib/api';
import {
  LLM_PROVIDERS,
  defaultModelFor,
  getLlmProvider,
} from '../lib/llmProviders';
import type { AppSettings, LlmProvider, LlmStatus } from '../types';

const DEFAULT: AppSettings = {
  llmProvider: 'deepseek',
  llmModel: 'deepseek-chat',
  searchProvider: 'openserp',
  searchUrl: 'http://localhost:8080',
  showApiKey: false,
};

export function Settings() {
  const [settings, setSettings] = useLocalStorage<AppSettings>('settings', DEFAULT);
  const [apiKey, setApiKey] = useLocalStorage<string>('llm_api_key', '');
  const [serpApiKey, setSerpApiKey] = useLocalStorage<string>('serp_api_key', '');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  /** 最近一次成功保存的快照,用于检测"未保存修改" */
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({
    settings,
    apiKey,
    serpApiKey,
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
    });
    const snap = JSON.stringify({
      settings: stripUi(savedSnapshot.settings),
      apiKey: savedSnapshot.apiKey,
      serpApiKey: savedSnapshot.serpApiKey,
    });
    return cur !== snap;
  }, [settings, apiKey, serpApiKey, savedSnapshot]);

  /** 还原快照,丢弃当前修改 */
  const revert = () => {
    setSettings(savedSnapshot.settings);
    setApiKey(savedSnapshot.apiKey);
    setSerpApiKey(savedSnapshot.serpApiKey);
  };

  // 进入页面拉取后端 LLM 状态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getLlmStatus();
        if (!cancelled) {
          setLlmStatus(s);
          // 以后端实际生效的 provider/model 回填表单(后端是权威来源,
          // 避免 localStorage 与 .env 不一致导致看不到真实配置)
          setSettings((prev) => ({
            ...prev,
            llmProvider: s.provider,
            llmModel: s.model || prev.llmModel,
          }));
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
    setSaveError(null);
    setSaved(false);
    try {
      // 仅在用户填了 key 时才上报到后端(避免空字符串误覆盖)
      if (apiKey.trim().length > 0) {
        const res = await api.updateLlmApiKey(apiKey.trim());
        if (!res.ok) throw new Error(res.message ?? '保存失败');
        // 重新拉取后端状态
        const s = await api.getLlmStatus();
        setLlmStatus(s);
      }
      // 搜索配置(provider + SerpAPI Key):始终同步,让"更精准数据"的配置真实生效
      const searchRes = await api.updateSearchConfig({
        provider: settings.searchProvider,
        apiKey: serpApiKey.trim(),
      });
      if (!searchRes.ok) throw new Error(searchRes.message ?? '搜索配置保存失败');
      // 保存成功后更新快照,isDirty 随即恢复为 false
      setSavedSnapshot({ settings, apiKey, serpApiKey });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

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
    <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
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

      <Card title="大模型 API">
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
              placeholder="例如 deepseek-chat"
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

          {!loadingStatus && llmStatus && (
            <>
              {/* 当前生效配置 */}
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
                      return '未配置';
                    })()}
                  </span>
                </div>
              </div>

              {/* 各 Provider 配置状态(由前端 LLM_PROVIDERS 注册表驱动) */}
              <div className="rounded-lg border border-border bg-card-solid/40 p-4 space-y-1.5">
                <div className="text-helper text-text-secondary font-medium mb-2">
                  Provider 配置状态
                </div>
                {LLM_PROVIDERS.map((p) => (
                  <div key={p.id} className="flex justify-between gap-4">
                    <span className="text-helper text-text-secondary">
                      {p.label}
                      {p.brand ? (
                        <span className="ml-1 text-text-tertiary">· {p.brand}</span>
                      ) : null}
                    </span>
                    <span className="text-helper">
                      {!p.requiresKey ? (
                        <span className="text-text-secondary">本地无需 Key</span>
                      ) : llmStatus.providerKeyMap[p.id] ? (
                        <span className="text-success">✅ 已配置</span>
                      ) : (
                        <span className="text-warning">未配置</span>
                      )}
                    </span>
                  </div>
                ))}
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

      <div className="flex justify-end gap-2">
        <Button
          onClick={() => void save()}
          disabled={loadingStatus || !isDirty}
          variant={isDirty ? 'primary' : 'outline'}
          title={!isDirty ? '当前无变化,无需保存' : '保存到后端'}
        >
          {saved ? '已保存' : isDirty ? '保存设置' : '无需保存'}
        </Button>
      </div>

      <div className="mt-8 text-helper text-text-secondary">
        注:前端保存的 API Key 会同步写入后端进程与
        <code className="mx-1 px-1 bg-hover-bg rounded text-primary-light">.env</code>
        文件,后续 LLM 调用将立即使用新 Key,无需重启服务。
      </div>
    </main>
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