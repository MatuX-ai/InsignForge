/**
 * 首页 - 深色玻璃拟态主题
 * 垂直居中布局:大标题 + 输入框 + 主按钮 + 需求库链接
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Textarea } from '../components/Textarea';
import { Banner } from '../components/Banner';
import { ResearchProgress } from '../components/ResearchProgress';
import { LlmSetupPrompt } from '../components/LlmSetupPrompt';
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
  const {
      trigger,
      loading,
      error: researchError,
      errorCode,
      retryAttempt,
      status,
    } = useResearch();
  const navigate = useNavigate();
  const [setupOpen, setSetupOpen] = useState(false);

  const canSubmit = value.trim().length >= 5 && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      const project = await api.createProject(value.trim());
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
      navigate(`/report/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showError = error ?? researchError;
  const showSetupModal =
    !loading && (errorCode === 'MISSING_API_KEY' || setupOpen);

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">
        {/* 标题区 */}
        <div className="text-center">
          <h1 className="text-title text-text-primary mb-2">
            <span className="bg-gradient-to-r from-primary-light via-accent to-cyan bg-clip-text text-transparent">
              InsightForge
            </span>
          </h1>
          <p className="text-body text-text-secondary">
            从一个想法到有数据支撑的市场报告,只需 5 分钟
          </p>
        </div>

        {/* 输入区 - 玻璃拟态卡片 */}
        <div className="w-full bg-card backdrop-blur-xl border border-border rounded-card p-6 shadow-glass">
          <div className="w-full flex flex-col gap-4">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={PLACEHOLDER}
              maxLength={500}
            />
            {showError && (
              <Banner tone="error" title="提示">
                {showError}
                {retryAttempt > 0 && (
                  <div className="mt-2 text-text-secondary">
                    🔄 正在自动重试 ({retryAttempt} / 3)…
                  </div>
                )}
              </Banner>
            )}
            <div className="flex flex-col items-center gap-4">
              <Button onClick={submit} disabled={!canSubmit} loading={loading}>
                马上验证想法
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const q = value.trim();
                  navigate(q ? `/discuss?q=${encodeURIComponent(q)}` : '/discuss');
                }}
              >
                我还没有想清楚,需要探讨一下
              </Button>
              <div className="flex gap-3 items-center text-helper text-text-tertiary">
                <button
                  type="button"
                  onClick={() => setValue(EXAMPLE)}
                  className="hover:text-primary-light hover:underline transition-colors"
                >
                  使用示例
                </button>
                <span className="text-border-solid">|</span>
                <a
                  href="/history"
                  className="hover:text-primary-light hover:underline transition-colors"
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
        </div>

        {loading && status && (
          <ResearchProgress
            progress={status.progress}
            currentStep={status.execution.current_step}
            startedAt={status.execution.started_at}
            className="text-helper text-text-secondary max-w-md"
          />
        )}
      </div>

      <LlmSetupPrompt
        open={showSetupModal}
        errorCode={errorCode}
        onClose={() => setSetupOpen(false)}
        onGoSettings={() => navigate('/settings')}
      />
    </main>
  );
}
