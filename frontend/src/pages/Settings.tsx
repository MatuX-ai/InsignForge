/**
 * 设置页 - 按前端设计文档 §3.4
 * LLM Provider 配置 + 搜索引擎配置
 */
import { useState } from 'react';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { AppSettings } from '../types';

const DEFAULT: AppSettings = {
  llmProvider: 'deepseek',
  llmModel: 'deepseek-chat',
  searchProvider: 'openserp',
  searchUrl: 'http://localhost:8080',
  showApiKey: false,
};

export function Settings() {
  const [settings, setSettings] = useLocalStorage<AppSettings>('settings', DEFAULT);
  const [saved, setSaved] = useState(false);
  const [apiKey, setApiKey] = useLocalStorage<string>('llm_api_key', '');

  const save = () => {
    // localStorage hook 已自动持久化,这里只给视觉反馈
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
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
              密钥仅保存在浏览器 localStorage,不会上传到任何服务器
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-helper text-text-secondary">状态:</span>
            <span className="text-success text-helper">✅ 已配置(本地保存)</span>
          </div>
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
        <Button onClick={save}>{saved ? '已保存' : '保存设置'}</Button>
      </div>

      <div className="mt-8 text-helper text-text-secondary">
        注:浏览器端的设置仅用于提示与展示。实际 API Key 由后端
        <code className="mx-1 px-1 bg-hover-bg rounded">.env</code>
        文件中的环境变量提供,修改后端配置后需重启服务。
      </div>
    </main>
  );
}