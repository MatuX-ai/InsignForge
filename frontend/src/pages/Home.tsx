/**
 * 首页 - 按前端设计文档 §3.1
 * 垂直居中布局:大标题 + 输入框 + 主按钮 + 需求库链接
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Textarea } from '../components/Textarea';
import { useResearch } from '../hooks/useResearch';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { api } from '../lib/api';
import type { HistoryEntry } from '../types';

const PLACEHOLDER =
  '描述你想验证的产品或功能,例如:"一个帮助程序员远程结对编程的 VS Code 插件"';

const EXAMPLE =
  '一个帮助独立开发者快速验证 SaaS 想法的桌面工具';

export function Home() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, setHistory] = useLocalStorage<HistoryEntry[]>('history', []);
  const { trigger, loading, error: researchError, status } = useResearch();
  const navigate = useNavigate();

  const canSubmit = value.trim().length >= 5 && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      const project = await api.createProject(value.trim());
      // 写入历史
      setHistory((prev) => [
        {
          project_id: project.id,
          name: project.name,
          description: project.description,
          created_at: project.created_at,
        },
        ...prev.filter((h) => h.project_id !== project.id),
      ].slice(0, 50));
      await trigger(project.id);
      // 跳转报告页
      navigate(`/report/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showError = error ?? researchError;

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">
        <h1 className="text-title text-text-primary">InsightForge</h1>
        <p className="text-body text-text-secondary text-center -mt-4">
          从一个想法到有数据支撑的市场报告,只需 5 分钟
        </p>

        <div className="w-full flex flex-col gap-3">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={PLACEHOLDER}
            maxLength={500}
          />
          {showError && (
            <div className="text-helper text-red-600">{showError}</div>
          )}
          <div className="flex flex-col items-center gap-4">
            <Button onClick={submit} disabled={!canSubmit} loading={loading}>
              验证想法
            </Button>
            <div className="flex gap-3 items-center text-helper text-text-secondary">
              <button
                type="button"
                onClick={() => setValue(EXAMPLE)}
                className="hover:text-primary hover:underline"
              >
                使用示例
              </button>
              <span className="text-border">|</span>
              <a
                href="/history"
                className="hover:text-primary hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/history');
                }}
              >
                或者从需求库找灵感 →
              </a>
            </div>
          </div>
        </div>

        {loading && status && (
          <div className="text-helper text-text-secondary mt-4">
            {status.progress}
          </div>
        )}
      </div>
    </main>
  );
}