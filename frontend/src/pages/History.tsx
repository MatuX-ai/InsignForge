/**
 * 历史记录 - 按前端设计文档 §3.3
 * v1.1 优化:
 *   - 从后端拉取真实项目列表 (替代 localStorage)
 *   - 增加搜索/筛选功能
 *   - 每条记录显示摘要信息 (热度评分、状态、竞品数等)
 *   - 支持删除项目
 *   - 支持按状态筛选
 */
import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { useDialog } from '../components/Dialog';
import type { Project, HistoryArchives } from '../types';

type FilterStatus = 'all' | 'completed' | 'analyzing' | 'failed' | 'draft';
type SortBy = 'time_desc' | 'time_asc' | 'heat_desc' | 'competitors_desc';

const SORT_LABEL: Record<SortBy, string> = {
  time_desc: '最新优先',
  time_asc: '最早优先',
  heat_desc: '热度 ↓',
  competitors_desc: '竞品数 ↓',
};

export function History() {
  const navigate = useNavigate();
  const dialog = useDialog();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archives, setArchives] = useState<HistoryArchives>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('time_desc');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 加载项目列表 + 历史文档归档状态
  useEffect(() => {
    loadProjects();
    loadArchives();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadArchives = async () => {
    try {
      const a = await api.getArchives();
      setArchives(a);
    } catch {
      // 归档目录不存在等场景静默忽略
    }
  };

  // 搜索 + 筛选 + 排序
  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((p) => {
      // 状态筛选
      if (filterStatus !== 'all' && p.status !== filterStatus) return false;
      // 关键词搜索
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          (p.keywords && p.keywords.some((k) => k.toLowerCase().includes(q)))
        );
      }
      return true;
    });

    const getHeat = (p: Project): number => {
      if (p.status !== 'completed' || !p.report) return -1;
      return (p.report as { market_heat: { heat_score: number } }).market_heat.heat_score;
    };
    const getCompetitorCount = (p: Project): number => {
      if (p.status !== 'completed' || !p.report) return -1;
      return (p.report as { competitors: unknown[] }).competitors.length;
    };
    const getTime = (p: Project): number =>
      new Date(p.created_at).getTime();

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'time_desc':
          return getTime(b) - getTime(a);
        case 'time_asc':
          return getTime(a) - getTime(b);
        case 'heat_desc':
          return getHeat(b) - getHeat(a);
        case 'competitors_desc':
          return getCompetitorCount(b) - getCompetitorCount(a);
      }
    });

    return sorted;
  }, [projects, searchQuery, filterStatus, sortBy]);

  // 统计各状态数量
  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = {
      all: projects.length,
      completed: 0,
      analyzing: 0,
      failed: 0,
      draft: 0,
    };
    projects.forEach((p) => {
      if (p.status in counts) {
        counts[p.status as FilterStatus]++;
      }
    });
    return counts;
  }, [projects]);

  // 删除项目
  const handleDelete = async (projectId: string, projectName: string) => {
    const ok = await dialog.confirm({
      title: '删除项目',
      message: `确定删除项目"${projectName}"吗?\n此操作不可恢复。`,
      primaryLabel: '删除',
      secondaryLabel: '取消',
      tone: 'danger',
    });
    if (!ok) return;
    setDeletingId(projectId);
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      await dialog.alert({
        title: '删除失败',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const statusLabel: Record<FilterStatus, string> = {
    all: '全部',
    completed: '已完成',
    analyzing: '分析中',
    failed: '失败',
    draft: '草稿',
  };

  return (
    <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">历史记录</h1>
        <Button variant="outline" onClick={() => navigate('/')}>
          + 新建调研
        </Button>
      </div>

      {/* 搜索和筛选栏 */}
      <div className="bg-card backdrop-blur-xl border border-border rounded-card p-4 mb-6 shadow-glass">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* 搜索框 */}
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="搜索项目名称、描述或关键词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 px-4 pr-10 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                ✕
              </button>
            )}
          </div>

          {/* 排序 */}
          <div className="flex items-center gap-2 sm:w-auto">
            <label
              htmlFor="history-sort"
              className="text-helper text-text-secondary shrink-0"
            >
              排序
            </label>
            <select
              id="history-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
            >
              {(Object.keys(SORT_LABEL) as SortBy[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 状态筛选标签 */}
        <div className="flex flex-wrap gap-2 mt-3">
          {(Object.keys(statusLabel) as FilterStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1 text-sm rounded-full transition-all ${
                filterStatus === status
                  ? 'bg-gradient-to-r from-primary to-primary-dark text-white shadow-glow-sm'
                  : 'bg-card-solid/50 text-text-secondary hover:bg-hover-bg border border-border'
              }`}
            >
              {statusLabel[status]}
              <span className="ml-1 opacity-70">({statusCounts[status]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6">
          <Banner tone="error" title="加载失败" action={{ label: '重试', onClick: loadProjects }}>
            {error}
          </Banner>
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <div className="bg-card backdrop-blur-xl border border-border rounded-card p-10 text-center text-text-secondary shadow-glass">
          加载中...
          <div className="mt-3 inline-flex items-center gap-1">
            <span className="dot-1">.</span>
            <span className="dot-2">.</span>
            <span className="dot-3">.</span>
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && filteredProjects.length === 0 && (
        <div className="bg-card backdrop-blur-xl border border-border rounded-card p-10 text-center shadow-glass">
          {projects.length === 0 ? (
            <>
              <div className="text-text-secondary mb-2">还没有任何调研项目</div>
              <div className="text-helper text-text-secondary mb-4">
                开始你的第一个市场调研吧
              </div>
              <Link to="/" className="text-primary hover:underline">
                → 去验证一个新想法
              </Link>
            </>
          ) : (
            <>
              <div className="text-text-secondary mb-2">没有匹配的项目</div>
              <div className="text-helper text-text-secondary">
                试试调整搜索关键词或筛选条件
              </div>
            </>
          )}
        </div>
      )}

      {/* 项目列表 */}
      {!loading && !error && filteredProjects.length > 0 && (
        <div className="space-y-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              archive={archives[sanitizeArchiveKey(project.name)]}
              onDelete={handleDelete}
              deleting={deletingId === project.id}
            />
          ))}
        </div>
      )}

      {/* 底部统计 */}
      {!loading && !error && filteredProjects.length > 0 && (
        <div className="mt-6 text-helper text-text-secondary text-center">
          显示 {filteredProjects.length} / {projects.length} 条记录
        </div>
      )}
    </main>
  );
}

/**
 * 与后端 archive.ts 保持一致的项目名归档键:
 * 移除非法字符 + 截断 60 字符,用于匹配历史文档目录
 */
function sanitizeArchiveKey(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

/** 单个项目卡片 */
function ProjectCard({
  project,
  archive,
  onDelete,
  deleting,
}: {
  project: Project;
  archive?: { dir: string; files: string[] };
  onDelete: (id: string, name: string) => void;
  deleting: boolean;
}) {
  const navigate = useNavigate();
  const dialog = useDialog();

  const handleClick = () => {
    navigate(`/report/${project.id}`);
  };

  /** 用系统默认程序打开归档文件(桌面端) */
  const handleOpenFile = async (file: string) => {
    if (!archive) return;
    if (!window.insightforge?.openPath) {
      await dialog.alert({
        title: '桌面端专属功能',
        message: '仅桌面端支持直接打开归档文件。',
        tone: 'warning',
      });
      return;
    }
    const fullPath = `${archive.dir}\\${file}`;
    const res = await window.insightforge.openPath(fullPath);
    if (!res?.ok) {
      await dialog.alert({
        title: '打开失败',
        message: res?.message ?? '未知错误',
        tone: 'danger',
      });
    }
  };

  /** 打开归档文件夹(资源管理器) */
  const handleOpenDir = async () => {
    if (!archive) return;
    if (!window.insightforge?.openPath) {
      await dialog.alert({
        title: '桌面端专属功能',
        message: '仅桌面端支持打开历史文档目录。',
        tone: 'warning',
      });
      return;
    }
    const res = await window.insightforge.openPath(archive.dir);
    if (!res?.ok) {
      await dialog.alert({
        title: '打开失败',
        message: res?.message ?? '未知错误',
        tone: 'danger',
      });
    }
  };

  const archiveFiles = archive?.files ?? [];

  /** 继续探讨: 创建讨论会话并跳转,AI 会自动问用户"你有什么新的想法？" */
  const handleContinueDiscuss = async (e: React.MouseEvent, projectId: string, projectName: string) => {
    e.stopPropagation();
    try {
      const res = await api.createDiscussion({
        title: `${projectName} - 继续探讨`,
        mode: 'free',
        projectId,
        firstMessage: '欢迎回来！这是一个新的探讨开始。请先简短确认一下这个项目的背景，然后问用户：你有什么新的想法或想探讨的方向？',
      });
      navigate(`/discuss/${res.session.id}`);
    } catch (err) {
      await dialog.alert({
        title: '创建讨论失败',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    }
  };

  return (
    <div
      className="bg-card backdrop-blur-xl border border-border rounded-card p-4 hover:border-primary/40 hover:shadow-glow-sm transition-all cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-body font-medium text-text-primary truncate">
              {project.name}
            </h3>
            <StatusBadge kind={statusKind(project.status)} />
          </div>
          <p className="text-helper text-text-secondary line-clamp-2 mb-2">
            {project.description}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-helper text-text-secondary">
            <span>
              📅 {new Date(project.created_at).toLocaleDateString('zh-CN')}
            </span>
            {project.keywords && project.keywords.length > 0 && (
              <span className="flex items-center gap-1 flex-wrap">
                🏷️
                {project.keywords.slice(0, 3).map((k) => (
                  <span
                    key={k}
                    className="px-2 py-0.5 bg-primary/10 text-primary-light rounded text-xs border border-primary/20"
                  >
                    {k}
                  </span>
                ))}
                {project.keywords.length > 3 && (
                  <span className="text-text-secondary">
                    +{project.keywords.length - 3}
                  </span>
                )}
              </span>
            )}
            {project.status === 'completed' && project.report && (
              <span className="text-emerald-400">
                🔥 热度 {(project.report as { market_heat: { heat_score: number } }).market_heat.heat_score}/100
              </span>
            )}
            {project.status === 'completed' && project.report && (
              <span className="text-text-secondary">
                🏢 竞品 {(project.report as { competitors: unknown[] }).competitors.length} 个
              </span>
            )}
          </div>

          {/* 胶囊按钮: 查看报告 / 打开历史归档文件 */}
          <div className="flex flex-wrap gap-2 mt-3">
            {project.status === 'completed' && project.report && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/report/${project.id}`);
                }}
                className="px-3 py-1 text-xs rounded-full border border-primary/30 bg-primary/10 text-primary-light hover:bg-primary/20 transition-colors"
              >
                📄 查看报告
              </button>
            )}
            {archiveFiles.map((file) => (
              <button
                key={file}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleOpenFile(file);
                }}
                title={`打开 ${file}`}
                className="px-3 py-1 text-xs rounded-full border border-border bg-card-solid/50 text-text-secondary hover:text-primary hover:border-primary/40 transition-colors"
              >
                📎 {file}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* PDF 图标: 历史文档已生成时展示 */}
          {archiveFiles.length > 0 && (
            <button
              type="button"
              onClick={() => void handleOpenDir()}
              title={`历史文档已生成 (${archiveFiles.length} 个文件),点击打开文件夹`}
              className="text-lg text-red-400 hover:text-red-300 transition-colors"
            >
              📄
            </button>
          )}
          <button
            type="button"
            onClick={(e) => void handleContinueDiscuss(e, project.id, project.name)}
            className="px-3 py-1 text-xs rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
            title="继续探讨"
          >
            💬 继续探讨
          </button>
          <Link
            to={`/report/${project.id}`}
            className="text-primary hover:underline text-[15px]"
          >
            {project.status === 'completed' ? '查看报告 →' : project.status === 'analyzing' ? '查看进度 →' : '开始调研 →'}
          </Link>
          <button
            type="button"
            onClick={() => onDelete(project.id, project.name)}
            disabled={deleting}
            className="text-helper text-text-secondary hover:text-red-600 disabled:opacity-50"
            title="删除项目"
          >
            {deleting ? '删除中...' : '🗑️'}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusKind(s: string): 'success' | 'warning' | 'failed' | 'analyzing' | 'idle' {
  if (s === 'completed') return 'success';
  if (s === 'failed') return 'failed';
  if (s === 'analyzing') return 'analyzing';
  if (s === 'draft') return 'idle';
  return 'warning';
}
