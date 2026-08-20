/**
 * 设置页 - 按前端设计文档 §3.4
 * LLM Provider 配置 + 搜索引擎配置
 *
 * 注意:API Key 保存后会同步写入后端内存与 .env 文件,无需重启服务。
 */
import { useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { api } from '../lib/api';
import type { AppSettings, LlmStatus } from '../types';

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
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // 进入页面拉取后端 LLM 状态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getLlmStatus();
        if (!cancelled) {
          setLlmStatus(s);
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
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
      <h1 className="text-title text-text-primary mb-6">设置</h1>

      <Card title="大模型 API">
        <div className="space-y-4">
          <div>
            <label className="text-helper text-text-secondary block mb-1">
              Provider
            </label>
            <select
              value={settings.llmProvider}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  llmProvider: e.target.value as AppSettings['llmProvider'],
                })
              }
              className="w-full h-10 px-3 border border-border rounded bg-card text-body focus:outline-none focus:border-primary"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (本地)</option>
            </select>
          </div>

          <div>
            <label className="text-helper text-text-secondary block mb-1">
              Model
            </label>
            <input
              type="text"
              value={settings.llmModel}
              onChange={(e) =>
                setSettings({ ...settings, llmModel: e.target.value })
              }
              className="w-full h-10 px-3 border border-border rounded bg-card text-body focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-helper text-text-secondary block mb-1">
              API Key
            </label>
            <div className="flex gap-2">
              <input
                type={settings.showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="flex-1 h-10 px-3 border border-border rounded bg-card text-body focus:outline-none focus:border-primary"
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
            ) : llmStatus?.provider === 'ollama' ? (
              <span className="text-success text-helper">
                ✅ 本地 Ollama,无需 Key
              </span>
            ) : llmStatus?.hasApiKey ? (
              <span className="text-success text-helper">
                ✅ 已配置
                {llmStatus.runtimeOverride && '(本次会话已更新)'}
              </span>
            ) : (
              <span className="text-warning text-helper">
                ⚠ 未配置,无法调用 LLM
              </span>
            )}
          </div>

          {saveError && (
            <div className="text-helper text-red-600">
              保存到后端失败:{saveError}
            </div>
          )}
        </div>
      </Card>

      <div className="my-6">
        <Card title="搜索引擎">
          <div className="space-y-4">
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
                className="w-full h-10 px-3 border border-border rounded bg-card text-body focus:outline-none focus:border-primary"
              >
                <option value="openserp">OpenSerp</option>
                <option value="serpapi">SerpAPI</option>
              </select>
            </div>

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
                className="w-full h-10 px-3 border border-border rounded bg-card text-body focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-helper text-text-secondary">状态:</span>
              <span className="text-text-secondary text-helper">
                由后端服务决定是否可达
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={loadingStatus}>
          {saved ? '已保存' : '保存设置'}
        </Button>
      </div>

      <div className="mt-8 text-helper text-text-secondary">
        注:前端保存的 API Key 会同步写入后端进程与
        <code className="mx-1 px-1 bg-hover-bg rounded">.env</code>
        文件,后续 LLM 调用将立即使用新 Key,无需重启服务。
      </div>
    </main>
  );
}