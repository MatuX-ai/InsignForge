/**
 * 首页 - 深色玻璃拟态主题
 * 垂直居中布局:大标题 + 输入框 + 主按钮 + 想法示例库 + 继续上次调研
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Textarea } from '../components/Textarea';
import { Banner } from '../components/Banner';
import { Container } from '../components/Container';
import { ResearchLoadingPanel } from '../components/ResearchLoadingPanel';
import { LlmSetupPrompt } from '../components/LlmSetupPrompt';
import { useResearch } from '../hooks/useResearch';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { api } from '../lib/api';
import type { HistoryEntry, Project } from '../types';

const PLACEHOLDER =
  '描述你想验证的产品或功能,例如:"一个帮助程序员远程结对编程的 VS Code 插件"';

/**
 * 想法示例库 - 按领域分类,点击即填入输入框
 * 覆盖 SaaS / 工具 / 内容 / 硬件 / 教育 五类,降低新用户冷启动门槛(P2-13)
 */
const EXAMPLE_LIBRARY: ReadonlyArray<{ tag: string; label: string; idea: string }> = [
  {
    tag: 'SaaS',
    label: '独立开发者 SaaS',
    idea: '一个帮助独立开发者快速验证 SaaS 想法的桌面工具',
  },
  {
    tag: '工具',
    label: 'VS Code 插件',
    idea: '一个帮助程序员远程结对编程的 VS Code 插件',
  },
  {
    tag: '内容',
    label: 'AI 内容助手',
    idea: '一款面向小红书博主的爆款标题生成器',
  },
  {
    tag: '硬件',
    label: '智能硬件',
    idea: '一个面向远程团队的智能降噪会议麦克风',
  },
  {
    tag: '教育',
    label: '在线教育',
    idea: '帮助初中生通过短视频学懂数学几何的 AI 教练',
  },
];

export function Home() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, setHistory] = useLocalStorage<HistoryEntry[]>('history', []);
  const [lastProject, setLastProject] = useState<Project | null>(null);
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

  // P2-13: 进入页面时拉取最近一次调研,显示"继续上次调研"卡片
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listProjects();
        if (!cancelled && list.length > 0) {
          // 按 created_at 倒序取最新
          const sorted = [...list].sort((a, b) =>
            (b.created_at ?? '').localeCompare(a.created_at ?? '')
          );
          setLastProject(sorted[0]!);
        }
      } catch {
        // 静默忽略 - 后端不可达时仍可正常使用"输入想法 → 验证"主流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    <Container display="centered" size="xl">
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

        {/* 继续上次调研 (P2-13) - 进入页面拉取最近一次调研,有则展示 */}
        {lastProject && (
          <button
            type="button"
            onClick={() => navigate(`/report/${lastProject.id}`)}
            className="w-full bg-card-solid/40 hover:bg-card-solid/70 border border-border rounded-card px-4 py-3 flex items-center gap-3 transition-colors text-left group"
          >
            <span className="text-helper text-text-tertiary shrink-0">⏮</span>
            <div className="flex-1 min-w-0">
              <div className="text-helper text-text-secondary">继续上次调研</div>
              <div className="text-body text-text-primary truncate">
                {lastProject.name}
              </div>
            </div>
            <span className="text-helper text-primary-light opacity-0 group-hover:opacity-100 transition-opacity">
              打开 →
            </span>
          </button>
        )}

        {/* 输入区 - 玻璃拟态卡片 */}
        <div className="w-full bg-card backdrop-blur-xl border border-border rounded-card p-6 shadow-glass">
          <div className="w-full flex flex-col gap-4">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={PLACEHOLDER}
              maxLength={500}
              // v1.8 P0-A4: 桌面端可用 Ctrl/Cmd/Alt+Enter 直接提交,
              // Shift+Enter 仍为换行,与 Notion / Slack / IDE 习惯一致
              onCmdEnter={() => void submit()}
            />
            {showError && (
              <Banner
                tone="error"
                title="提示"
                // v1.8 P0-A6: 点击「复制诊断」可把上下文一键发给我们,避免手动截图
                copyLabel="复制诊断"
                copyText={`[InsightForge 错误诊断]\n时间: ${new Date().toISOString()}\n重试次数: ${retryAttempt}\n用户输入: ${value.trim().slice(0, 500)}\n错误信息: ${showError}\n后端地址: ${typeof window !== 'undefined' ? window.location.origin : ''}`}
              >
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
            </div>
          </div>
        </div>

        {/* 想法示例库 (P2-13) - 按领域分类,点击即填入 */}
        <div className="w-full">
          <div className="text-helper text-text-secondary mb-2 px-1">
            没想好?从这些想法开始
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_LIBRARY.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setValue(item.idea)}
                className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card-solid/40 hover:bg-primary/15 border border-border hover:border-primary/40 text-helper transition-colors"
              >
                <span className="text-primary-light font-medium">{item.tag}</span>
                <span className="text-text-secondary group-hover:text-text-primary">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 历史记录入口 */}
        <div className="flex gap-3 items-center text-helper text-text-tertiary">
          <a
            href="/history"
            className="hover:text-primary-light hover:underline transition-colors"
            onClick={(e) => {
              e.preventDefault();
              navigate('/history');
            }}
          >
            或者从历史调研找灵感 →
          </a>
        </div>

        {loading && status && (
          // vNext: 用完整的走马灯 + 数据瀑布面板替代单行 ResearchProgress,
          // 在 Home 提交后到 /report 跳转前这段时间也能感受到"AI 在工作"。
          <ResearchLoadingPanel
            progress={status.progress}
            currentStep={status.execution.current_step}
            startedAt={status.execution.started_at}
            metrics={status.execution.metrics ?? null}
            className="max-w-md w-full"
          />
        )}
      </div>

      <LlmSetupPrompt
        open={showSetupModal}
        errorCode={errorCode}
        onClose={() => setSetupOpen(false)}
        onGoSettings={() => navigate('/settings')}
      />
    </Container>
  );
}
