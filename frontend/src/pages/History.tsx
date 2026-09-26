/**
 * 历史记录 - 按前端设计文档 §3.3
 * v1.1 优化:
 *   - 从后端拉取真实项目列表 (替代 localStorage)
 *   - 增加搜索/筛选功能
 *   - 每条记录显示摘要信息 (热度评分、状态、竞品数等)
 *   - 支持删除项目
 *   - 支持按状态筛选
 * v1.7 优化 (FR-10):
 *   - 跨项目全文检索:输入关键词后调后端 /projects/search,
 *     不仅匹配项目元信息(name/description/keywords),
 *     还深入匹配报告正文(summary / market_size / competitors / user_persona / features)。
 *   - 命中字段以「上下文片段」形式返回并以卡片下方的 Quote 形式呈现。
 */
import { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useDesktopApi } from '../hooks/useDesktopApi';
import { useProjectTags, type UseProjectTagsApi } from '../hooks/useProjectTags';
import { useSwipeBack } from '../hooks/useSwipeBack';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Modal } from '../components/Modal';
import { Container } from '../components/Container';
import { Dropdown } from '../components/Dropdown';
import { useDialog } from '../components/Dialog';
import type { Project, HistoryArchives, ProjectSearchHit } from '../types';

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
  // v1.8 P8-C: 移动端边缘右滑返回(桌面端零开销)
  useSwipeBack();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archives, setArchives] = useState<HistoryArchives>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('time_desc');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // v1.8 P7-B: 自定义标签 - localStorage 存储,UI 显示 + 筛选
  const tagsApi = useProjectTags();
  // 当前筛选的 tag 集合(多选,空数组表示不过滤)
  const [activeTags, setActiveTags] = useState<string[]>([]);

  // v1.8 P5-A: 多选对比 — 选中后勾选的项目 ID 集合,用于跳转到 /compare 路由
  // 仅 status='completed' 且 report 存在的项目可被选中;否则勾选框禁用并提示原因
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const MAX_COMPARE_COUNT = 4;

  // 仅"已完成"项目可参与对比
  const selectableProjects = useMemo(
    () =>
      projects.filter(
        (p: Project) => p.status === 'completed' && p.report,
      ),
    [projects],
  );
  const selectableIdSet = useMemo(
    () => new Set(selectableProjects.map((p: Project) => p.id)),
    [selectableProjects],
  );

  // FR-10: 跨项目全文检索结果(关键词非空时才拉)
  const [searchHits, setSearchHits] = useState<ProjectSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载项目列表 + 历史文档归档状态
  useEffect(() => {
    loadProjects();
    loadArchives();
  }, []);

  // FR-10: 跨项目全文检索 - 300ms debounce,关键词非空时调后端
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!trimmed) {
      setSearchHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await api.searchProjects(trimmed, 30);
        setSearchHits(res.hits);
      } catch {
        // 后端检索失败时回退到 client-side 行为,不阻塞列表渲染
        setSearchHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchQuery]);

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
      // v1.8 P7-B: tag 筛选 - 项目必须包含全部 activeTags
      if (activeTags.length > 0) {
        const projectTags = tagsApi.getTags(p.id);
        if (!activeTags.every((t: string) => projectTags.includes(t))) return false;
      }
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
  }, [projects, searchQuery, filterStatus, sortBy, activeTags, tagsApi]);

  // 当任意筛选条件切换时,如果 activeTags 包含已不存在的 tag,自动清掉
  useEffect(() => {
    if (activeTags.length === 0) return;
    setActiveTags((prev: string[]) => prev.filter((t: string) => tagsApi.allTags.includes(t)));
  }, [tagsApi.allTags]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // v1.8 P2-C: 支持三种模式 - default / clean(同步清理归档)/ export-then-delete(导出后删除)
  const handleDelete = async (
    projectId: string,
    projectName: string,
    archiveKey: string | null,
    mode: 'default' | 'clean' | 'export-then-delete'
  ) => {
    const modeLabel =
      mode === 'clean'
        ? '删除项目并清理归档文件'
        : mode === 'export-then-delete'
          ? '导出报告后删除项目'
          : '删除项目';
    const modeMessage =
      mode === 'clean'
        ? `将永久删除项目"${projectName}"及其历史归档目录(所有生成的商业计划书/开发文档等)。\n此操作不可恢复。`
        : mode === 'export-then-delete'
          ? `将先下载报告(${projectName}.md)到本地,然后删除该项目数据库记录。\n历史归档目录会保留。`
          : `将永久删除项目"${projectName}"的数据库记录。\n历史归档目录会保留。`;
    const ok = await dialog.confirm({
      title: modeLabel,
      message: modeMessage,
      primaryLabel: '确认删除',
      secondaryLabel: '取消',
      tone: 'danger',
    });
    if (!ok) return;
    setDeletingId(projectId);
    try {
      // 导出后删除: 先下载报告,即使下载失败也不阻塞删除流程
      if (mode === 'export-then-delete') {
        try {
          downloadUrl(api.reportDownloadUrl(projectId, 'md'));
        } catch (err) {
          console.warn('[History] 导出报告失败,继续删除:', err);
        }
      }
      await api.deleteProject(projectId);
      // 清理归档(成功后刷新 archives)
      if (mode === 'clean' && archiveKey) {
        try {
          await api.deleteArchive(archiveKey);
        } catch (err) {
          console.warn('[History] 清理归档失败:', err);
        }
        // 重新拉一次 archives 列表,确保 UI 同步
        void loadArchives();
      }
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

  /**
   * v1.8 P5-A: 切换项目的对比选中状态
   * - 仅 completed 状态可参与对比
   * - 最多 4 份,超出时给出 toast 提示并不再加入
   * - 删除项目后自动从选中列表移除
   */
  const toggleCompareSelection = (projectId: string) => {
    if (!selectableIdSet.has(projectId)) return;
    setSelectedForCompare((prev: string[]) => {
      if (prev.includes(projectId)) {
        return prev.filter((id: string) => id !== projectId);
      }
      if (prev.length >= MAX_COMPARE_COUNT) {
        // 用 setTimeout 异步弹 toast,避免在 setter 中触发 setState
        window.setTimeout(() => {
          void dialog.alert({
            title: '对比数量已达上限',
            message: `最多支持 ${MAX_COMPARE_COUNT} 份报告并排对比。请取消部分选中后重试。`,
            tone: 'warning',
          });
        }, 0);
        return prev;
      }
      return [...prev, projectId];
    });
  };

  // 项目加载完成 / 删除后,清理已不存在或状态变为非 completed 的选中
  useEffect(() => {
    setSelectedForCompare((prev: string[]) =>
      prev.filter((id: string) => selectableIdSet.has(id)),
    );
  }, [selectableIdSet]);

  /**
   * v1.8 P5-A: 跳转到对比视图
   */
  const goCompare = () => {
    if (selectedForCompare.length < 2) {
      void dialog.alert({
        title: '请至少选择 2 份报告',
        message: '对比视图至少需要 2 份已完成报告。请再勾选一份。',
        tone: 'warning',
      });
      return;
    }
    navigate(`/compare?ids=${selectedForCompare.join(',')}`);
  };

  return (
    <Container size="lg">
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
              placeholder="搜索项目名称、描述、关键词以及报告正文... (跨项目全文检索 v1.7)"
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
            {searching && (
              <span className="absolute right-9 top-1/2 -translate-y-1/2 text-helper text-text-tertiary animate-pulse">
                检索中
              </span>
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

        {/* v1.8 P7-B: 自定义标签筛选 - 多选模式,只显示用户已用过的 tag */}
        {tagsApi.allTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-helper text-text-secondary shrink-0">
              🏷️ 标签
            </span>
            {tagsApi.allTags.map((tag) => {
              const active = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setActiveTags((prev: string[]) =>
                      active
                        ? prev.filter((t: string) => t !== tag)
                        : [...prev, tag],
                    )
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 text-helper rounded-full transition-colors ${
                    active
                      ? 'bg-accent/20 text-accent border border-accent/40'
                      : 'bg-card-solid/50 text-text-secondary hover:bg-accent/10 border border-border'
                  }`}
                  aria-pressed={active}
                >
                  <span>{tag}</span>
                  <span className="opacity-60">({tagsApi.tagCounts[tag]})</span>
                </button>
              );
            })}
            {activeTags.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTags([])}
                className="text-helper text-text-secondary hover:text-text-primary px-2 py-1 rounded transition-colors"
              >
                清除筛选
              </button>
            )}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6">
          <Banner
            tone="error"
            title="加载失败"
            action={{ label: '重试', onClick: loadProjects }}
            // v1.8 P1-E: 历史页错误诊断 - 路径 + 错误信息 + 时间戳
            copyLabel="复制诊断"
            copyText={`[InsightForge 历史页错误诊断]\n时间: ${new Date().toISOString()}\n页面: /history\n后端地址: ${typeof window !== 'undefined' ? window.location.origin : ''}\n错误信息: ${error}`}
          >
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

      {/* 项目列表 - v1.8 P2-B: 列表项 stagger 渐入 */}
      {!loading && !error && filteredProjects.length > 0 && (
        <div className="space-y-3">
          {filteredProjects.map((project, index) => {
            const archiveKey = sanitizeArchiveKey(project.name);
            return (
              <div
                key={project.id}
                className="if-stagger-item"
                style={{ ['--stagger-i' as string]: Math.min(index, 12) }}
              >
                <ProjectCard
                  project={project}
                  archive={archives[archiveKey]}
                  archiveKey={archiveKey}
                  hasArchive={Boolean(archives[archiveKey])}
                  onDelete={handleDelete}
                  deleting={deletingId === project.id}
                  // v1.8 P5-A: 对比勾选 + 可选状态
                  selectable={selectableIdSet.has(project.id)}
                  selected={selectedForCompare.includes(project.id)}
                  onToggleCompare={() => toggleCompareSelection(project.id)}
                  // v1.8 P7-B: 自定义标签 - 共享 tagsApi 给所有卡片(避免每个 Card 各自读 localStorage)
                  tagsApi={tagsApi}
                  onTagClick={(tag: string) =>
                    setActiveTags((prev: string[]) =>
                      prev.includes(tag) ? prev : [...prev, tag],
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {/* FR-10: 跨项目全文检索结果区,展示报告正文命中上下文 */}
      {searchQuery.trim() && (
        <section className="mt-8 border-t border-border/30 pt-6">
          <header className="mb-3 flex items-center gap-2">
            <span aria-hidden className="text-primary-light">🔎</span>
            <h2 className="text-section-title text-text-primary">报告全文命中</h2>
            <span className="text-helper text-text-secondary">
              {searching
                ? '检索中…'
                : searchHits.length > 0
                  ? `关键词 “${searchQuery.trim()}” 匹配到 ${searchHits.length} 份报告`
                  : `未在报告正文中找到 “${searchQuery.trim()}”`}
            </span>
          </header>

          {!searching && searchHits.length === 0 && (
            <div className="bg-card/40 backdrop-blur border border-border rounded-card p-4 text-helper text-text-secondary">
              提示:尝试调整关键词(支持中英文子串),或在顶部输入框上方的状态筛选中勾选不同状态。
            </div>
          )}

          {!searching && searchHits.length > 0 && (
            <ul className="space-y-3">
              {searchHits.map((hit) => (
                <li
                  key={hit.project.id}
                  className="bg-card/60 backdrop-blur border border-border rounded-card p-4 shadow-glass"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <Link
                      to={`/report/${hit.project.id}`}
                      className="text-body text-text-primary hover:text-primary-light font-medium"
                    >
                      {hit.project.name}
                    </Link>
                    <span className="text-helper text-text-tertiary">
                      命中 {hit.matchedFields.length} 个字段
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {hit.matchedFields.slice(0, 6).map((f) => (
                      <span
                        key={f}
                        className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full border border-primary/30 bg-primary/10 text-primary-light"
                      >
                        {f}
                      </span>
                    ))}
                    {hit.matchedFields.length > 6 && (
                      <span className="text-helper text-text-tertiary">
                        +{hit.matchedFields.length - 6}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {Object.entries(hit.snippets).slice(0, 3).map(([field, snippet]) => (
                      <div
                        key={field}
                        className="text-helper text-text-secondary border-l-2 border-primary/30 pl-2"
                      >
                        <span className="text-text-tertiary">{field}:</span>{' '}
                        <HighlightSnippet text={snippet} q={searchQuery.trim()} />
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 底部统计 */}
      {!loading && !error && filteredProjects.length > 0 && (
        <div className="mt-6 text-helper text-text-secondary text-center">
          显示 {filteredProjects.length} / {projects.length} 条记录
        </div>
      )}

      {/* v1.8 P5-A: 对比浮动操作栏 — 选中 ≥1 份已完成报告时浮出,
          显示已选数量与「对比选中」入口;点击后跳转 /compare?ids=...
          位置:fixed 底部居中,避开 TopBar,移动端下也不会盖住列表滚动 */}
      {selectedForCompare.length >= 1 && (
        <div
          role="region"
          aria-label="对比操作栏"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-card/95 backdrop-blur-xl border border-primary/30 rounded-2xl shadow-glow-md px-4 py-3 flex items-center gap-3 animate-if-panel-rise max-w-[calc(100vw-2rem)]"
        >
          <div className="text-helper text-text-secondary flex items-center gap-1">
            <span aria-hidden className="text-primary-light">📊</span>
            <span>
              已选{' '}
              <span className="text-text-primary font-semibold">
                {selectedForCompare.length}
              </span>{' '}
              / {MAX_COMPARE_COUNT}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedForCompare([])}
            className="text-helper text-text-secondary hover:text-text-primary px-2 py-1 rounded transition-colors"
            title="清空对比选择"
            aria-label="清空对比选择"
          >
            清空
          </button>
          <Button
            onClick={goCompare}
            disabled={selectedForCompare.length < 2}
            title={
              selectedForCompare.length < 2
                ? '至少选择 2 份报告才能对比'
                : `对比 ${selectedForCompare.length} 份报告`
            }
          >
            对比选中 ({selectedForCompare.length})
          </Button>
        </div>
      )}
    </Container>
  );
}

/**
 * 高亮片段:把 q 在 text 中所有出现位置用 <mark> 包裹
 * 用于 FR-10 跨项目全文检索结果区
 */
function HighlightSnippet({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const ql = q.toLowerCase();
  const tl = text.toLowerCase();
  const parts: Array<{ str: string; match: boolean }> = [];
  let cursor = 0;
  let idx = tl.indexOf(ql, cursor);
  while (idx >= 0) {
    if (idx > cursor) parts.push({ str: text.slice(cursor, idx), match: false });
    parts.push({ str: text.slice(idx, idx + q.length), match: true });
    cursor = idx + q.length;
    idx = tl.indexOf(ql, cursor);
  }
  if (cursor < text.length) parts.push({ str: text.slice(cursor), match: false });
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark
            key={i}
            className="bg-amber-400/30 text-amber-100 px-0.5 rounded"
          >
            {p.str}
          </mark>
        ) : (
          <span key={i}>{p.str}</span>
        )
      )}
    </>
  );
}

/**
 * 与后端 archive.ts 保持一致的项目名归档键:
 * 移除非法字符 + 截断 60 字符,用于匹配历史文档目录
 */
function sanitizeArchiveKey(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

/**
 * WARN-04 修复: 直接触发后端下载 URL(相对路径),由浏览器/桌面端原生处理保存
 * 不走 blob:, 在 Electron 主进程弹出保存对话框期间 HTTP 流不会因 revoke 而失效
 * 与 Report.tsx 的 downloadUrl 同款实现
 */
function downloadUrl(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

/** 单个项目卡片 */
function ProjectCard({
  project,
  archive,
  archiveKey,
  hasArchive,
  onDelete,
  deleting,
  // v1.8 P5-A: 对比勾选 props
  selectable = false,
  selected = false,
  onToggleCompare,
  // v1.8 P7-B: 标签 API + 点击 tag 时联动筛选
  tagsApi,
  onTagClick,
}: {
  project: Project;
  archive?: { dir: string; files: string[] };
  /** v1.8 P2-C: sanitize 后的归档目录名(用于「删除并清理归档」场景) */
  archiveKey: string;
  /** v1.8 P2-C: 当前项目是否存在归档文件(决定清理菜单是否启用) */
  hasArchive: boolean;
  /** v1.8 P2-C: 删除模式 - default / clean / export-then-delete */
  onDelete: (
    id: string,
    name: string,
    archiveKey: string,
    mode: 'default' | 'clean' | 'export-then-delete'
  ) => void;
  deleting: boolean;
  /** v1.8 P5-A: 是否可参与对比(仅 completed 且有报告) */
  selectable?: boolean;
  /** v1.8 P5-A: 是否已被选中对比 */
  selected?: boolean;
  /** v1.8 P5-A: 切换选中回调 */
  onToggleCompare?: () => void;
  /** v1.8 P7-B: 标签管理 API - 共享自父级,避免每个 Card 重复读 localStorage */
  tagsApi: UseProjectTagsApi;
  /** v1.8 P7-B: 点击现有 tag 触发筛选(空函数也行) */
  onTagClick?: (tag: string) => void;
}) {
  const navigate = useNavigate();
  const dialog = useDialog();
  /** v1.8 P0-A3: 集中消费桌面端 API,避免散落 `window.insightforge?.openPath` */
  const desktop = useDesktopApi();
  /** v1.7 P2-10: 归档包弹窗 - 不再直接资源管理器默认打开,而让用户从列表选择 */
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  /** v1.8 P7-B: 标签输入态 - 哪个项目正在编辑 + 当前输入草稿 */
  const [tagAddingId, setTagAddingId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');

  const handleClick = () => {
    navigate(`/report/${project.id}`);
  };

  /** 用系统默认程序打开归档文件(桌面端) */
  const handleOpenFile = async (file: string) => {
    if (!archive) return;
    if (!desktop.isDesktop) {
      await dialog.alert({
        title: '桌面端专属功能',
        message: '仅桌面端支持直接打开归档文件。',
        tone: 'warning',
      });
      return;
    }
    const sep = desktop.platform === 'darwin' ? '/' : '\\';
    const fullPath = `${archive.dir}${sep}${file}`;
    const res = await desktop.openPath(fullPath);
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
    if (!desktop.isDesktop) {
      await dialog.alert({
        title: '桌面端专属功能',
        message: '仅桌面端支持打开历史文档目录。',
        tone: 'warning',
      });
      return;
    }
    const res = await desktop.openPath(archive.dir);
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
      className={`bg-card backdrop-blur-xl border rounded-card p-4 hover:border-primary/40 hover:shadow-glow-sm transition-all cursor-pointer ${
        // v1.8 P5-A: 选中态视觉反馈 - 蓝色边框 + 蓝色背景
        selected
          ? 'border-primary shadow-glow-sm bg-primary/5'
          : 'border-border'
      }`}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-4">
        {/* v1.8 P5-A: 对比勾选框 - 放在标题左侧,click 阻止冒泡避免跳转到报告页 */}
        {selectable && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? `从对比移除 ${project.name}` : `加入对比 ${project.name}`}
            title={selected ? '从对比移除' : '加入对比(最多 4 份)'}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              onToggleCompare?.();
            }}
            className={`shrink-0 mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              selected
                ? 'bg-primary border-primary text-white'
                : 'border-border hover:border-primary/60'
            }`}
          >
            {selected && (
              <svg
                aria-hidden
                viewBox="0 0 12 12"
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 6.5L5 9L10 3" />
              </svg>
            )}
          </button>
        )}
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

          {/* v1.8 P7-B: 自定义标签 - 复用 ProjectCard 横向空间,展示 + 添加/删除 */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {tagsApi.getTags(project.id).map((tag: string) => (
              <span
                key={tag}
                className="group inline-flex items-center gap-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent text-helper"
              >
                <button
                  type="button"
                  onClick={() => onTagClick?.(tag)}
                  className="pl-2.5 pr-1 py-0.5 hover:underline"
                  title={`按标签筛选「${tag}」`}
                >
                  {tag}
                </button>
                <button
                  type="button"
                  onClick={() => tagsApi.removeTag(project.id, tag)}
                  className="px-1.5 py-0.5 text-accent/60 hover:text-red-400 transition-colors rounded-r-full"
                  aria-label={`删除标签「${tag}」`}
                >
                  ✕
                </button>
              </span>
            ))}
            {tagAddingId === project.id ? (
              <input
                type="text"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    tagsApi.addTag(project.id, tagDraft);
                    setTagDraft('');
                    setTagAddingId(null);
                  } else if (e.key === 'Escape') {
                    setTagDraft('');
                    setTagAddingId(null);
                  }
                }}
                onBlur={() => {
                  if (tagDraft.trim()) tagsApi.addTag(project.id, tagDraft);
                  setTagDraft('');
                  setTagAddingId(null);
                }}
                placeholder="新标签"
                maxLength={12}
                autoFocus
                className="h-6 px-2 text-helper rounded-full border border-accent/40 bg-bg/60 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
              />
            ) : (
              tagsApi.getTags(project.id).length < 5 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagDraft('');
                    setTagAddingId(project.id);
                  }}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 text-helper text-text-tertiary hover:text-accent border border-dashed border-border hover:border-accent/40 rounded-full transition-colors"
                  title="添加标签(最多 5 个)"
                >
                  <span aria-hidden>+</span>
                  <span>标签</span>
                </button>
              )
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* v1.7 P2-10: 点击归档图标不再直接调资源管理器,
               而是打开一个 Modal 让用户选择打开哪个文件(或全部浏览)。 */}
          {archiveFiles.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowArchiveModal(true);
              }}
              title={`历史文档已生成 (${archiveFiles.length} 个文件),点击查看并打开`}
              className="text-lg text-red-400 hover:text-red-300 transition-colors"
            >
              📄
            </button>
          )}
          <button
            type="button"
            onClick={(e) => void handleContinueDiscuss(e, project.id, project.name)}
            className="px-3 py-1 text-xs rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
            title="继续探讨"
          >
            💬 继续探讨
          </button>
          <Link
            to={`/report/${project.id}`}
            className="text-primary hover:underline text-[15px] whitespace-nowrap"
          >
            {project.status === 'completed' ? '查看报告 →' : project.status === 'analyzing' ? '查看进度 →' : '开始调研 →'}
          </Link>
          {/* v1.8 P2-C: 删除二级菜单 - 删除 / 清理归档后删除 / 导出后删除 */}
          <Dropdown
            align="right"
            panelClassName="min-w-[210px]"
            trigger={
              <button
                type="button"
                disabled={deleting}
                className="text-helper text-text-secondary hover:text-red-600 disabled:opacity-50"
                title="删除项目"
                aria-label="删除项目"
              >
                {deleting ? '删除中...' : '🗑️'}
              </button>
            }
            items={[
              {
                label: (
                  <span className="flex items-center gap-2">
                    <span>🗑️</span>
                    <span>删除项目</span>
                  </span>
                ),
                tone: 'default',
                onClick: () => onDelete(project.id, project.name, archiveKey, 'default'),
              },
              {
                label: (
                  <span className="flex items-center gap-2">
                    <span>🧹</span>
                    <span>删除并清理归档</span>
                    {hasArchive && (
                      <span className="ml-auto text-label text-text-tertiary">
                        {archive?.files.length ?? 0} 个文件
                      </span>
                    )}
                  </span>
                ),
                tone: 'danger',
                disabled: !hasArchive,
                onClick: () => onDelete(project.id, project.name, archiveKey, 'clean'),
              },
              {
                label: (
                  <span className="flex items-center gap-2">
                    <span>📥</span>
                    <span>导出报告后删除</span>
                  </span>
                ),
                tone: 'danger',
                // 仅已完成的项目有报告可导出
                disabled: project.status !== 'completed' || deleting,
                onClick: () => onDelete(project.id, project.name, archiveKey, 'export-then-delete'),
              },
            ]}
          />
        </div>
      </div>

      {/* v1.7 P2-10: 归档包预览 Modal - 展示所有文件,让用户选择打开哪个或全部浏览
           v1.7 WARN-04: Web 环境(没有 openPath 桥接)额外提供「打包下载 .zip」按钮,
           让 Web 用户也能一次性带走整个项目归档 */}
      <Modal
        open={showArchiveModal}
        onClose={() => setShowArchiveModal(false)}
        title={`历史文档归档 · ${archiveFiles.length} 个文件`}
        secondaryLabel={
          archive && desktop.isDesktop
            ? '打开归档文件夹'
            : archive
              ? '打包下载 .zip' // WARN-04: Web 环境替代行为
              : undefined
        }
        onSecondary={() => {
          setShowArchiveModal(false);
          if (desktop.isDesktop) {
            void handleOpenDir();
          } else {
            // WARN-04: Web 版调用后端打包流下载
            if (archive) downloadUrl(api.archiveDownloadUrl(archive.dir.split(/[\\/]/).pop() ?? ''));
          }
        }}
        primaryLabel="关闭"
      >
        <div className="space-y-2">
          {!archive ? (
            <div className="text-helper text-text-secondary">未发现归档</div>
          ) : (
            <>
              <div className="text-helper text-text-secondary">
                点击单个文件可使用系统默认应用打开(桌面端专享)。
                {desktop.isDesktop
                  ? '点击右上角“打开归档文件夹”可在资源管理器中查看。'
                  : 'Web 版本请点击右上角「打包下载 .zip」一次性带走到本地。'}
              </div>
              <ul className="border border-border rounded-lg divide-y divide-border bg-card-solid/30 max-h-72 overflow-y-auto">
                {archiveFiles.map((file) => (
                  <li
                    key={file}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden className="text-text-tertiary shrink-0">
                        📄
                      </span>
                      <span
                        className="text-body text-text-primary truncate"
                        title={file}
                      >
                        {file}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        // 在弹窗内打开单个文件后不主动关闭,让用户可以连续点多个文件;
                        // 只有桌面端支持。Web 环境会弹个友好提示。
                        void handleOpenFile(file);
                      }}
                      className="text-helper text-primary hover:underline shrink-0"
                      title="打开此文件"
                    >
                      打开 →
                    </button>
                  </li>
                ))}
              </ul>
              {archive.dir && (
                <div className="text-helper text-text-tertiary break-all" title={archive.dir}>
                  路径:{archive.dir}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
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
