/**
 * 讨论梳理画布页 - /discuss
 *
 * 左: 结构化画布(分组 → 要点),支持增删改、移动要点、重命名/删除分组
 * 右: 与 AI 逐轮讨论,AI 每轮自动把对话提炼成画布要点,并可按要求重组
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { useDialog } from '../components/Dialog';
import { api } from '../lib/api';
import type {
  CanvasGroup,
  CanvasPointStatus,
  DiscussionChatJob,
  DiscussionMode,
  DiscussionOp,
  DiscussionSession,
} from '../types';

const MODES: Array<{ value: DiscussionMode; label: string; desc: string }> = [
  {
    value: 'business_model',
    label: '商业模式画布',
    desc: '经典 9 格画布:客户细分 / 价值主张 / 渠道 / 收入 / 成本等',
  },
  {
    value: 'lean_canvas',
    label: '精益画布',
    desc: '更聚焦创业验证:问题 / 解决方案 / 独特卖点 / 关键指标 / 壁垒',
  },
  {
    value: 'swot',
    label: 'SWOT 分析',
    desc: '优势 / 劣势 / 机会 / 威胁,适合战略盘点',
  },
  {
    value: 'project',
    label: '软件项目要点',
    desc: '梳理项目目标 / 功能 / 场景 / 里程碑 / 风险等要点',
  },
  {
    value: 'free',
    label: '自由头脑风暴',
    desc: '不限框架,AI 随讨论自动组织分组',
  },
];

const STATUS_META: Record<CanvasPointStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-hover-bg text-text-secondary border-border' },
  confirmed: { label: '已确认', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  question: { label: '待澄清', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
};

const STATUS_CYCLE: CanvasPointStatus[] = ['draft', 'confirmed', 'question'];

const POLL_INTERVAL = 2000; // 讨论一轮比调研快,2s 轮询

/** 去掉要点文本两侧可能带的引号/书名号 */
function cleanText(s: string): string {
  return s.replace(/^[「『【"']\s*|\s*[」』】"']$/g, '').trim();
}

/**
 * 快捷改要点指令解析(自然语言,前端直接生效,不走 AI 回合)
 * 支持: 把「旧」改成「新」/ 将「旧」改为「新」/ 修改「旧」为「新」/ 「旧」=>「新」等
 * 返回 null 表示不是快捷指令,走正常 AI 讨论
 */
function parseQuickEdit(input: string): { oldText: string; newText: string } | null {
  const m = input
    .trim()
    .match(/[「『【]\s*([^」』】]+?)\s*[」』】]\s*(?:改成|改为|改作|换成|变成|=>|→|->|为)\s*(.+)$/);
  if (!m) return null;
  const oldText = cleanText(m[1]!);
  const newText = cleanText(m[2]!);
  if (!oldText || !newText) return null;
  return { oldText, newText };
}

export function Discuss() {
  const [sessions, setSessions] = useState<DiscussionSession[] | null>(null);
  const dialog = useDialog();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [session, setSession] = useState<DiscussionSession | null>(null);
  const [job, setJob] = useState<DiscussionChatJob | null>(null);
  const [organizeJob, setOrganizeJob] = useState<DiscussionChatJob | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 去验证: 正在创建项目并跳转 */
  const [validating, setValidating] = useState(false);

  // URL 参数支持:
  //   /discuss/:id   → 直接打开指定会话(报告页"进一步探讨"跳转)
  //   /discuss?q=xxx → 预填新建梳理的描述(首页"我还没有想清楚"跳转)
  const { id: urlId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 快捷改要点歧义选择: 多条匹配时让用户点选要改哪条
  const [quickEditAmbiguous, setQuickEditAmbiguous] = useState<{
    oldText: string;
    newText: string;
    candidates: Array<{ id: string; text: string; group: string }>;
  } | null>(null);
  const [quickEditFilter, setQuickEditFilter] = useState('');
  const [quickEditCollapsed, setQuickEditCollapsed] = useState<Set<string>>(new Set());
  // 防抖: 记录每个分组上次切换时间,100ms 内忽略重复点击,防止快速连点导致动画抖动
  const quickEditLastToggleRef = useRef<Map<string, number>>(new Map());
  // 搜索前的折叠状态快照: 开始搜索时保存,清空搜索时恢复
  const quickEditCollapsedBeforeSearchRef = useRef<Set<string> | null>(null);

  // 创建表单
  const [createMode, setCreateMode] = useState<DiscussionMode>('business_model');
  const [createTitle, setCreateTitle] = useState('');
  const [createMessage, setCreateMessage] = useState('');
  const [creating, setCreating] = useState(false);

  const running = job?.status === 'running';
  const organizing = organizeJob?.status === 'running';
  const anyRunning = running || organizing;

  // 搜索时自动展开有匹配项的分组,清空搜索后恢复原折叠状态
  useEffect(() => {
    if (!quickEditAmbiguous) return;
    const filter = quickEditFilter.trim().toLowerCase();

    if (!filter) {
      // 清空搜索: 恢复搜索前的折叠状态(如果有快照)
      if (quickEditCollapsedBeforeSearchRef.current) {
        setQuickEditCollapsed(new Set(quickEditCollapsedBeforeSearchRef.current));
        quickEditCollapsedBeforeSearchRef.current = null;
      }
      return;
    }

    // 开始搜索: 第一次输入时保存快照
    if (!quickEditCollapsedBeforeSearchRef.current) {
      quickEditCollapsedBeforeSearchRef.current = new Set(quickEditCollapsed);
    }

    // 找出有匹配项的分组,自动展开
    const groupsWithMatch = new Set<string>();
    for (const c of quickEditAmbiguous.candidates) {
      if (c.text.toLowerCase().includes(filter)) {
        groupsWithMatch.add(c.group);
      }
    }

    // 从当前折叠集合中移除有匹配的分组(即展开它们)
    setQuickEditCollapsed((prev) => {
      const next = new Set(prev);
      for (const g of groupsWithMatch) next.delete(g);
      return next;
    });
  }, [quickEditFilter, quickEditAmbiguous]);

  // 轮询:讨论任务 running 时每 2s 拉一次
  useEffect(() => {
    if (!currentId || !running) return;
    const timer = window.setInterval(async () => {
      try {
        const s = await api.getDiscussionChatStatus(currentId);
        setJob(s);
        if (s.status === 'success') {
          const fresh = await api.getDiscussion(currentId);
          setSession(fresh);
          setJob(null);
        } else if (s.status === 'failed') {
          setError(s.error_message ?? '讨论失败,请重试');
          setJob(null);
        }
      } catch (err) {
        // 404 或网络异常: 尝试重新拉取会话做最终确认
        // 可能是后端重启导致内存任务丢失,但结果可能已写入库
        try {
          const fresh = await api.getDiscussion(currentId);
          setSession(fresh);
        } catch {
          setError(err instanceof Error ? err.message : String(err));
        }
        setJob(null);
      }
    }, POLL_INTERVAL);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, running]);

  // 轮询:画布整理任务 running 时每 2s 拉一次
  useEffect(() => {
    if (!currentId || !organizing) return;
    const timer = window.setInterval(async () => {
      try {
        const s = await api.getOrganizeStatus(currentId);
        setOrganizeJob(s);
        if (s.status === 'success') {
          const fresh = await api.getDiscussion(currentId);
          setSession(fresh);
          setNotice('画布整理完成');
          setOrganizeJob(null);
        } else if (s.status === 'failed') {
          setError(s.error_message ?? '整理失败,请重试');
          setOrganizeJob(null);
        }
      } catch (err) {
        // 404 或网络异常: 尝试重新拉取会话做最终确认
        try {
          const fresh = await api.getDiscussion(currentId);
          setSession(fresh);
          setNotice('任务状态已同步');
        } catch {
          setError(err instanceof Error ? err.message : String(err));
        }
        setOrganizeJob(null);
      }
    }, POLL_INTERVAL);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, organizing]);

  // 加载会话列表
  const refreshList = async () => {
    try {
      setSessions(await api.listDiscussions());
    } catch {
      setSessions([]);
    }
  };

  useEffect(() => {
    void refreshList();
    if (urlId) {
      // 直接从 URL 打开指定会话(报告页"进一步探讨"等)
      void open(urlId);
    } else {
      // 首页"我还没有想清楚"携带的描述预填到新建梳理
      const q = searchParams.get('q');
      if (q) setCreateMessage(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 打开一个会话 */
  const open = async (id: string) => {
    setError(null);
    setQuickEditAmbiguous(null);
    try {
      const s = await api.getDiscussion(id);
      setCurrentId(id);
      setSession(s);
      // 同步 URL,便于刷新/分享后仍停留在该会话
      navigate(`/discuss/${id}`, { replace: true });
      // 恢复进行中的讨论任务(如从报告页创建会话后直接跳转过来)
      try {
        const st = await api.getDiscussionChatStatus(id);
        setJob(st.status === 'running' ? st : null);
      } catch {
        setJob(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 回到选择页 */
  const backToList = async () => {
    setCurrentId(null);
    setSession(null);
    setJob(null);
    setQuickEditAmbiguous(null);
    navigate('/discuss', { replace: true });
    await refreshList();
  };

  /** 创建会话(可选带首条消息直接开聊) */
  const create = async () => {
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      const res = await api.createDiscussion({
        title: createTitle.trim() || undefined,
        mode: createMode,
        message: createMessage.trim() || undefined,
      });
      setCurrentId(res.session.id);
      setSession(res.session);
      setJob(res.job);
      navigate(`/discuss/${res.session.id}`, { replace: true });
      if (res.job?.status === 'running') {
        // 用户消息已由后端入库,立即刷新对话区
        const fresh = await api.getDiscussion(res.session.id);
        setSession(fresh);
      }
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  /** 手动编辑画布(统一走后端 applyOps) */
  const onApply = async (ops: DiscussionOp[]) => {
    if (!currentId || ops.length === 0) return;
    try {
      const fresh = await api.applyDiscussionOps(currentId, ops);
      setSession(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 快捷改要点: 确认修改某条候选 */
  const confirmQuickEdit = async (pointId: string, oldText: string, newText: string) => {
    if (!currentId) return;
    setQuickEditAmbiguous(null);
    try {
      const fresh = await api.applyDiscussionOps(currentId, [
        { op: 'update_point', point_id: pointId, text: newText },
      ]);
      setSession(fresh);
      setChatInput('');
      setNotice(`已修改要点:${oldText} → ${newText}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 打开歧义选择面板(同时重置过滤和折叠状态) */
  const openQuickEditAmbiguous = (data: {
    oldText: string;
    newText: string;
    candidates: Array<{ id: string; text: string; group: string }>;
  }) => {
    setQuickEditAmbiguous(data);
    setQuickEditFilter('');
    setQuickEditCollapsed(new Set());
    quickEditLastToggleRef.current.clear();
  };

  /** 切换单个分组的展开/收起(带 100ms 防抖,避免快速连点导致动画抖动) */
  const toggleGroup = (groupName: string) => {
    const now = Date.now();
    const last = quickEditLastToggleRef.current.get(groupName) ?? 0;
    if (now - last < 100) return; // 100ms 内的重复点击忽略
    quickEditLastToggleRef.current.set(groupName, now);

    setQuickEditCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  };

  /** 全部展开/折叠(带 150ms 防抖,批量操作动画稍长,给多一点缓冲) */
  const toggleAllGroups = (collapse: boolean) => {
    const KEY = '__all__';
    const now = Date.now();
    const last = quickEditLastToggleRef.current.get(KEY) ?? 0;
    if (now - last < 150) return;
    quickEditLastToggleRef.current.set(KEY, now);

    if (!quickEditAmbiguous) return;
    const allGrouped = new Set<string>();
    for (const c of quickEditAmbiguous.candidates) {
      allGrouped.add(c.group);
    }
    setQuickEditCollapsed(collapse ? allGrouped : new Set());
  };

  /** 歧义候选按分组聚合 + 搜索过滤(useMemo 缓存,避免每次渲染重算) */
  const quickEditGrouped = useMemo(() => {
    if (!quickEditAmbiguous) return [];
    const groups = new Map<string, typeof quickEditAmbiguous.candidates>();
    for (const c of quickEditAmbiguous.candidates) {
      const list = groups.get(c.group) ?? [];
      list.push(c);
      groups.set(c.group, list);
    }
    const filter = quickEditFilter.trim().toLowerCase();
    return Array.from(groups.entries())
      .map(([groupName, points]) => {
        const filtered = filter
          ? points.filter((p) => p.text.toLowerCase().includes(filter))
          : points;
        return { groupName, points: filtered, total: points.length };
      })
      .filter((g) => g.points.length > 0);
  }, [quickEditAmbiguous, quickEditFilter]);

  /** 给要点列表补上所属分组名,用于歧义选择面板 */
  const buildCandidates = (
    points: Array<{ id: string; text: string }>
  ): Array<{ id: string; text: string; group: string }> => {
    const groupOf = new Map<string, string>();
    for (const g of session?.canvas.groups ?? []) {
      for (const p of g.points) groupOf.set(p.id, g.title);
    }
    return points.map((p) => ({ id: p.id, text: p.text, group: groupOf.get(p.id) ?? '' }));
  };

  /** 发送一轮讨论;命中快捷改要点指令时直接改画布,不走 AI */
  const send = async () => {
    const msg = chatInput.trim();
    if (!msg || !currentId || running) return;
    setError(null);
    setNotice(null);

    // 快捷指令: 把「旧」改成「新」 → 直接修改画布
    const quick = parseQuickEdit(msg);
    if (quick) {
      const points = session?.canvas.groups.flatMap((g) => g.points) ?? [];
      const exactMatches = points.filter((p) => p.text === quick.oldText);
      const fuzzyMatches = points.filter(
        (p) => p.text !== quick.oldText && p.text.includes(quick.oldText)
      );

      if (exactMatches.length === 0 && fuzzyMatches.length === 0) {
        setError(`画布中没有找到包含「${quick.oldText}」的要点`);
        return;
      }

      // 精确匹配唯一 → 直接改
      if (exactMatches.length === 1) {
        const target = exactMatches[0]!;
        try {
          const fresh = await api.applyDiscussionOps(currentId, [
            { op: 'update_point', point_id: target.id, text: quick.newText },
          ]);
          setSession(fresh);
          setChatInput('');
          setNotice(`已修改要点:${target.text} → ${quick.newText}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // 精确匹配多条 → 弹出歧义选择面板,让用户点选要改哪条
      if (exactMatches.length > 1) {
        openQuickEditAmbiguous({
          oldText: quick.oldText,
          newText: quick.newText,
          candidates: buildCandidates(exactMatches),
        });
        return;
      }

      // 无精确匹配但有模糊匹配
      if (fuzzyMatches.length === 1) {
        const target = fuzzyMatches[0]!;
        try {
          const fresh = await api.applyDiscussionOps(currentId, [
            { op: 'update_point', point_id: target.id, text: quick.newText },
          ]);
          setSession(fresh);
          setChatInput('');
          setNotice(`已修改要点:${target.text} → ${quick.newText}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // 模糊匹配多条 → 弹出歧义选择面板,让用户点选要改哪条
      openQuickEditAmbiguous({
        oldText: quick.oldText,
        newText: quick.newText,
        candidates: buildCandidates(fuzzyMatches),
      });
      return;
    }

    try {
      const j = await api.sendDiscussionMessage(currentId, msg);
      setChatInput('');
      setJob(j);
      const fresh = await api.getDiscussion(currentId);
      setSession(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 歧义选择: 用户点选某条候选后执行快捷修改 */
  const applyQuickEditSelect = async (pointId: string) => {
    if (!currentId || !quickEditAmbiguous) return;
    const { oldText, newText } = quickEditAmbiguous;
    try {
      const fresh = await api.applyDiscussionOps(currentId, [
        { op: 'update_point', point_id: pointId, text: newText },
      ]);
      setSession(fresh);
      setChatInput('');
      setNotice(`已修改要点:${oldText} → ${newText}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuickEditAmbiguous(null);
    }
  };

  const deleteSession = async () => {
    if (!currentId || !session) return;
    const ok = await dialog.confirm({
      title: '删除梳理',
      message: `删除梳理「${session.title}」?\n画布与对话将一并清除,不可恢复。`,
      primaryLabel: '删除',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.deleteDiscussion(currentId);
      await backToList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 去验证: 基于当前画布收敛的想法创建项目并开始调研 */
  const doValidate = async () => {
    if (!session || validating || anyRunning) return;
    const totalPoints = session.canvas.groups.reduce((n, g) => n + g.points.length, 0);
    if (totalPoints === 0) {
      setNotice('画布还没有要点,先和 AI 讨论收敛一下再验证');
      return;
    }
    const ok = await dialog.confirm({
      title: '创建调研项目',
      message: '将基于当前画布创建一个新项目并开始市场调研,确定继续吗?',
      primaryLabel: '开始调研',
    });
    if (!ok) return;
    setError(null);
    setNotice(null);
    setValidating(true);
    try {
      // 把画布要点收敛为项目描述(分组标题: 要点; 要点...),作为调研输入
      const parts: string[] = [];
      for (const g of session.canvas.groups) {
        const texts = g.points.map((p) => p.text).filter(Boolean);
        if (texts.length > 0) parts.push(`${g.title}: ${texts.join('; ')}`);
      }
      const desc = [session.title, ...parts].join('\n').slice(0, 2000);
      const name =
        session.title.replace(/\s+/g, ' ').trim().slice(0, 60) || '待验证想法';
      const project = await api.createProject(desc, name);
      // 报告页会自动检测并启动调研(Report.tsx 加载时若未生成报告会触发 trigger)
      navigate(`/report/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setValidating(false);
    }
  };

  /** 触发画布整理 */
  const organize = async () => {
    if (!currentId || !session || anyRunning) return;
    const totalPoints = session.canvas.groups.reduce((n, g) => n + g.points.length, 0);
    if (totalPoints === 0) {
      setNotice('画布为空,无需整理');
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const j = await api.organizeDiscussion(currentId);
      setOrganizeJob(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ---------- 选择页 ----------
  if (!currentId || !session) {
    return (
      <main className="flex-1 px-6 py-8 max-w-5xl w-full mx-auto">
        <h1 className="text-title text-text-primary mb-1">讨论梳理</h1>
        <p className="text-body text-text-secondary mb-8">
          和 AI 边聊边梳理,把模糊想法收敛成结构化要点画布,可随时增删改与重组
        </p>

        {error && <div className="mb-4"><Banner tone="error">{error}</Banner></div>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 新建 */}
          <div className="bg-card backdrop-blur-xl border border-border rounded-card p-5 shadow-glass">
            <h2 className="text-section text-text-primary mb-4">新建梳理</h2>
            <div className="flex flex-col gap-3 mb-4">
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                    createMode === m.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50 bg-card-solid/20'
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    className="mt-1 accent-primary"
                    checked={createMode === m.value}
                    onChange={() => setCreateMode(m.value)}
                  />
                  <span>
                    <span className="block text-body text-text-primary font-medium">
                      {m.label}
                    </span>
                    <span className="block text-helper text-text-secondary">{m.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="标题(可选),如:AI 编程助手项目的商业模式"
                value={createTitle}
                maxLength={100}
                onChange={(e) => setCreateTitle(e.target.value)}
                className="w-full h-10 px-3 text-[15px] text-text-primary bg-card-solid/50 border border-border rounded-lg focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 placeholder:text-text-tertiary"
              />
              <textarea
                placeholder="用一段话描述你想梳理的内容,例如:我想做一个面向独立开发者的 AI 编程助手,先帮我把商业模式理清楚…"
                value={createMessage}
                maxLength={2000}
                onChange={(e) => setCreateMessage(e.target.value)}
                className="w-full min-h-[120px] p-3 text-[15px] leading-6 text-text-primary bg-card-solid/50 border border-border rounded-lg resize-y focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 placeholder:text-text-tertiary"
              />
              <Button onClick={create} loading={creating}>
                开始梳理
              </Button>
            </div>
          </div>

          {/* 已有会话 */}
          <div className="bg-card backdrop-blur-xl border border-border rounded-card p-5 shadow-glass">
            <h2 className="text-section text-text-primary mb-4">继续之前的梳理</h2>
            {sessions === null ? (
              <div className="text-helper text-text-secondary">加载中...</div>
            ) : sessions.length === 0 ? (
              <div className="text-helper text-text-secondary">还没有梳理记录</div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto pr-1">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void open(s.id)}
                    className="text-left p-3 border border-border rounded-lg hover:border-primary/50 hover:bg-hover-bg transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body text-text-primary font-medium truncate">
                        {s.title}
                      </span>
                      <span className="text-label text-text-secondary shrink-0">
                        {MODES.find((m) => m.value === s.mode)?.label}
                      </span>
                    </div>
                    <div className="text-helper text-text-secondary mt-1 truncate">
                      {s.canvas.groups.length} 个分组 · {s.messages.length} 条对话 · 更新于{' '}
                      {new Date(s.updated_at).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ---------- 工作区 ----------
  return (
    <main className="flex-1 px-6 py-6 max-w-[1440px] w-full mx-auto flex flex-col min-h-0">
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => void backToList()}
          className="text-helper text-text-secondary hover:text-primary"
        >
          ← 返回
        </button>
        <h1 className="text-section text-text-primary truncate">{session.title}</h1>
        <span className="text-label text-text-secondary bg-hover-bg border border-border rounded px-2 py-0.5">
          {MODES.find((m) => m.value === session.mode)?.label}
        </span>
        {running && (
          <span className="text-helper text-primary inline-flex items-center gap-1">
            分析中<span className="dot-1">.</span>
            <span className="dot-2">.</span>
            <span className="dot-3">.</span>
          </span>
        )}
        <Button
          variant="primary"
          onClick={() => void doValidate()}
          disabled={anyRunning || validating}
          className="ml-auto"
        >
          {validating ? '正在创建项目...' : '去验证想法 →'}
        </Button>
        <button
          type="button"
          onClick={() => void deleteSession()}
          className="text-helper text-red-600 hover:underline"
        >
          删除
        </button>
      </div>

      {error && <div className="mb-3"><Banner tone="error">{error}</Banner></div>}
      {notice && (
        <div className="mb-3">
          <Banner tone="success" onClose={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      {/* 快捷改要点歧义选择: 思维导图式按分组树状展示 + 搜索过滤 */}
      {quickEditAmbiguous && (
        <div className="mb-3 border border-amber-500/30 bg-amber-500/10 rounded-lg p-3 backdrop-blur-sm">
          <div className="text-body text-amber-300 font-medium mb-1">
            找到 {quickEditAmbiguous.candidates.length} 条包含「{quickEditAmbiguous.oldText}」的要点
          </div>
          <div className="text-helper text-amber-400 mb-3">
            将改为:「{quickEditAmbiguous.newText}」
          </div>

          {/* 搜索过滤 */}
          <input
            type="text"
            value={quickEditFilter}
            onChange={(e) => setQuickEditFilter(e.target.value)}
            placeholder="搜索要点内容,快速定位..."
            className="w-full px-3 py-2 text-body border border-amber-500/30 rounded-lg bg-card-solid/50 text-text-primary focus:outline-none focus:border-amber-400 mb-3 placeholder:text-text-tertiary"
          />

          {/* 按分组树状展示 */}
          <div className="max-h-72 overflow-y-auto">
            {quickEditGrouped.length === 0 ? (
              <div className="text-helper text-text-secondary text-center py-4">
                没有匹配的要点
              </div>
            ) : (
              quickEditGrouped.map(({ groupName, points, total }) => {
                const collapsed = quickEditCollapsed.has(groupName);
                return (
                  <div key={groupName} className="mb-2">
                    {/* 分组标题(可折叠) */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(groupName)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-helper font-medium text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors"
                    >
                      <span className={`w-3 text-amber-400 transition-transform duration-200 inline-block ${collapsed ? '' : 'rotate-90'}`}>
                        ▶
                      </span>
                      <span className="flex-1 text-left">{groupName}</span>
                      <span className="text-amber-400">
                        {points.length}
                        {quickEditFilter.trim() && points.length !== total
                          ? ` / ${total}`
                          : ''}
                      </span>
                    </button>
                    {/* 要点列表(缩进展示,思维导图式) - 用 grid 行高做平滑展开动画 */}
                    <div
                      className={`grid transition-all duration-200 ease-out ${
                        collapsed
                          ? 'grid-rows-[0fr] opacity-0'
                          : 'grid-rows-[1fr] opacity-100'
                      }`}
                    >
                      <div className="overflow-hidden min-h-0">
                        <div className="ml-4 border-l-2 border-amber-500/30 pl-3 py-1 flex flex-col gap-1.5">
                          {points.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() =>
                                void confirmQuickEdit(
                                  c.id,
                                  c.text,
                                  quickEditAmbiguous.newText
                                )
                              }
                              className="text-left px-2.5 py-1.5 text-body bg-card-solid/50 border border-amber-500/20 rounded-lg hover:border-amber-400 hover:bg-amber-500/10 transition-all"
                            >
                              {c.text}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-between items-center mt-3 pt-2 border-t border-amber-500/30">
            <button
              type="button"
              onClick={() => {
                const totalGroups = quickEditAmbiguous
                  ? new Set(quickEditAmbiguous.candidates.map((c) => c.group)).size
                  : 0;
                const allCollapsed =
                  quickEditCollapsed.size > 0 &&
                  quickEditCollapsed.size === totalGroups;
                // 全部折叠 → 点击展开全部;否则(展开/部分折叠) → 点击折叠全部
                toggleAllGroups(allCollapsed ? false : true);
              }}
              className="text-helper text-amber-400 hover:text-amber-300"
            >
              {(() => {
                const totalGroups = quickEditAmbiguous
                  ? new Set(quickEditAmbiguous.candidates.map((c) => c.group)).size
                  : 0;
                const allCollapsed =
                  quickEditCollapsed.size > 0 &&
                  quickEditCollapsed.size === totalGroups;
                return allCollapsed ? '全部展开' : '全部折叠';
              })()}
            </button>
            <button
              type="button"
              onClick={() => setQuickEditAmbiguous(null)}
              className="text-helper text-text-secondary hover:text-text-primary"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-4 min-h-0">
        {/* 画布 */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-helper text-text-secondary">
              {organizing
                ? '正在整理画布...'
                : running
                  ? 'AI 分析中...'
                  : '可手动编辑,也可点「整理」自动去重合并'}
            </span>
            <Button variant="outline" onClick={() => void organize()} disabled={anyRunning}>
              {organizing ? '整理中...' : '整理画布'}
            </Button>
          </div>
          <CanvasPanel session={session} onApply={onApply} disabled={anyRunning} />
        </div>

        {/* 对话 */}
        <div className="bg-card backdrop-blur-xl border border-border rounded-card shadow-glass flex flex-col min-h-0 xl:h-full">
          <div className="px-4 py-3 border-b border-border text-body text-text-primary font-medium">
            与 AI 讨论
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-[240px] xl:min-h-0">
            {session.messages.length === 0 && (
              <div className="text-helper text-text-secondary my-auto text-center">
                在下方输入你的想法,AI 会把讨论提炼成画布要点
              </div>
            )}
            {session.messages.map((m, i) => (
              <ChatBubble
                role={m.role}
                content={m.content}
                createdAt={m.created_at}
                onCopied={() => setNotice('已复制到剪贴板')}
              />
            ))}
          </div>
          <div className="p-3 border-t border-border flex flex-col gap-2">
            {/* 快捷 prompt 模板 - 仅在空输入时展示 */}
            {!chatInput.trim() && (
              <div className="flex flex-wrap gap-2 mb-1">
                {(
                  [
                    '帮我梳理这个项目的商业模式',
                    '从用户视角列出 3 个核心痛点',
                    '对比现有 3 个同类产品的差异化机会',
                    '生成 10 条 MVP 验证问题清单',
                  ] as const
                ).map((tmpl) => (
                  <button
                    key={tmpl}
                    type="button"
                    onClick={() => setChatInput(tmpl)}
                    className="text-helper px-3 py-1 rounded-full border border-border bg-card-solid/40 text-text-secondary hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    💡 {tmpl}
                  </button>
                ))}
              </div>
            )}

            <textarea
              placeholder="输入想法或提问…快捷改要点:把「原要点文本」改成「新内容」"
              value={chatInput}
              maxLength={2000}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="w-full min-h-[72px] p-3 text-[14px] leading-5 text-text-primary bg-card-solid/50 border border-border rounded-lg resize-y focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 placeholder:text-text-tertiary"
            />
            <div className="flex items-center justify-between gap-3">
              <div className="text-helper text-text-secondary">
                快捷改要点:{'把「原要点文本」改成「新内容」'}· 即时生效,无需等待 AI
              </div>
              <div
                className={`text-label shrink-0 tabular-nums ${
                  chatInput.length > 1800
                    ? 'text-amber-400'
                    : chatInput.length > 1500
                      ? 'text-primary-light'
                      : 'text-text-tertiary'
                }`}
                aria-label="字符计数"
              >
                {chatInput.length} / 2000
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void send()} disabled={!chatInput.trim() || running}>
                发送 <span className="ml-1 text-helper opacity-70">⏎</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * 聊天气泡 - 加相对时间 + AI 消息复制按钮
 */
function ChatBubble({
  role,
  content,
  createdAt,
  onCopied,
}: {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  onCopied: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = role === 'user';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    onCopied();
    window.setTimeout(() => setCopied(false), 1500);
  };

  const time = formatRelativeTime(createdAt);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`max-w-[88%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
      >
        <div
          className={`relative px-3 py-2 text-[14px] leading-6 whitespace-pre-wrap rounded-lg ${
            isUser
              ? 'bg-gradient-to-r from-primary to-primary-dark text-white'
              : 'bg-hover-bg text-text-primary'
          }`}
        >
          {content}
        </div>
        <div
          className={`flex items-center gap-2 text-label text-text-tertiary opacity-60 group-hover:opacity-100 transition-opacity ${
            isUser ? 'flex-row-reverse' : ''
          }`}
        >
          <span title={new Date(createdAt).toLocaleString()}>{time}</span>
          {!isUser && (
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="复制消息"
              className="hover:text-text-primary transition-colors"
            >
              {copied ? '✓ 已复制' : '📋 复制'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 相对时间格式化 - "刚刚" / "3 分钟前" / "2 小时前" / "8/15" */
function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 画布面板:分组卡片网格 */
function CanvasPanel({
  session,
  onApply,
  disabled,
}: {
  session: DiscussionSession;
  onApply: (ops: DiscussionOp[]) => Promise<void>;
  disabled: boolean;
}) {
  const [newGroupTitle, setNewGroupTitle] = useState('');

  const addGroup = () => {
    if (disabled) return;
    const title = newGroupTitle.trim();
    if (!title) return;
    void onApply([{ op: 'add_group', title }]);
    setNewGroupTitle('');
  };

  return (
    <div className="bg-card backdrop-blur-xl border border-border rounded-card shadow-glass p-4 overflow-y-auto flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-body text-text-primary font-medium">要点画布</h2>
        <span className="text-label text-text-secondary">
          {session.canvas.groups.reduce((n, g) => n + g.points.length, 0)} 个要点
        </span>
      </div>

      {session.canvas.groups.length === 0 ? (
        <div className="text-helper text-text-secondary my-auto text-center py-12">
          画布为空。在右侧和 AI 讨论,或在下方直接创建分组
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 content-start">
          {session.canvas.groups.map((g) => (
            <GroupCard key={g.id} group={g} groups={session.canvas.groups} onApply={onApply} disabled={disabled} />
          ))}
        </div>
      )}

      {/* 新增分组 */}
      <div className="mt-4 flex gap-2">
        <input
          type="text"
          placeholder="新分组标题,如:商业模式、痛点…"
          value={newGroupTitle}
          maxLength={50}
          disabled={disabled}
          onChange={(e) => setNewGroupTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addGroup();
          }}
          className="flex-1 h-9 px-3 text-[14px] text-text-primary bg-card-solid/50 border border-border rounded-lg focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 placeholder:text-text-tertiary disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <Button variant="outline" onClick={addGroup} disabled={disabled || !newGroupTitle.trim()}>
          添加分组
        </Button>
      </div>
    </div>
  );
}

/** 单个分组卡片 */
function GroupCard({
  group,
  groups,
  onApply,
  disabled,
}: {
  group: CanvasGroup;
  groups: CanvasGroup[];
  onApply: (ops: DiscussionOp[]) => Promise<void>;
  disabled: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(group.title);
  const [newPoint, setNewPoint] = useState('');
  const dialog = useDialog();

  const commitRename = () => {
    if (disabled) {
      setTitle(group.title);
      setRenaming(false);
      return;
    }
    const t = title.trim();
    if (t && t !== group.title) void onApply([{ op: 'rename_group', group_id: group.id, title: t }]);
    else setTitle(group.title);
    setRenaming(false);
  };

  const addPoint = () => {
    if (disabled) return;
    const text = newPoint.trim();
    if (!text) return;
    void onApply([{ op: 'add_point', group_id: group.id, text }]);
    setNewPoint('');
  };

  const targets = groups.filter((g) => g.id !== group.id);

  return (
    <div className="border border-border rounded-lg p-3 bg-bg-secondary/50 backdrop-blur-sm flex flex-col gap-2 min-w-0">
      {/* 分组标题 */}
      <div className="flex items-center gap-2">
        {renaming ? (
          <input
            type="text"
            value={title}
            maxLength={50}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setTitle(group.title);
                setRenaming(false);
              }
            }}
            className="flex-1 min-w-0 h-7 px-2 text-[14px] font-medium text-text-primary bg-card-solid/50 border border-primary/50 rounded-lg focus:outline-none"
          />
        ) : (
          <span
            title="点击重命名"
            className="flex-1 min-w-0 truncate text-body text-text-primary font-medium cursor-pointer hover:underline disabled:opacity-40"
            onClick={() => {
              if (!disabled) setRenaming(true);
            }}
          >
            {group.title}
          </span>
        )}
        <button
          type="button"
          title="删除分组"
          disabled={disabled}
          onClick={async () => {
            const ok = await dialog.confirm({
              title: '删除分组',
              message: `删除分组「${group.title}」及其 ${group.points.length} 个要点?\n此操作不可恢复。`,
              primaryLabel: '删除',
              tone: 'danger',
            });
            if (ok) {
              void onApply([{ op: 'delete_group', group_id: group.id }]);
            }
          }}
          className="text-helper text-text-secondary hover:text-red-600 disabled:opacity-40"
        >
          删除
        </button>
      </div>

      {/* 要点列表 */}
      <div className="flex flex-col gap-1.5 min-h-[24px]">
        {group.points.map((p) => {
          const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(p.status) + 1) % STATUS_CYCLE.length]!;
          const meta = STATUS_META[p.status];
          return (
            <div key={p.id} className="bg-card-solid/50 border border-border rounded-lg px-2 py-1.5 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  title="点击切换状态"
                  disabled={disabled}
                  onClick={() =>
                    void onApply([{ op: 'update_point', point_id: p.id, status: nextStatus }])
                  }
                  className={`shrink-0 mt-0.5 text-label px-1.5 py-0.5 border rounded ${meta.cls}`}
                >
                  {meta.label}
                </button>
                <span className="flex-1 min-w-0 text-[13px] leading-5 text-text-primary break-words">
                  {p.text}
                  {p.note && (
                    <span className="block text-helper text-text-secondary">备注: {p.note}</span>
                  )}
                </span>
                <button
                  type="button"
                  title="删除要点"
                  disabled={disabled}
                  onClick={() => void onApply([{ op: 'delete_point', point_id: p.id }])}
                  className="shrink-0 text-helper text-text-secondary hover:text-red-600 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
              {/* 移动要点到其他分组 */}
              {targets.length > 0 && (
                <select
                  disabled={disabled}
                  title="移动到分组"
                  value=""
                  onChange={(e) => {
                    const to = e.target.value;
                    if (to) void onApply([{ op: 'move_point', point_id: p.id, to_group_id: to }]);
                  }}
                  className="mt-1 w-full h-7 px-1.5 text-[12px] text-text-secondary bg-card-solid/50 border border-border rounded-lg focus:outline-none disabled:opacity-40"
                >
                  <option value="">移动到…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {/* 新增要点 */}
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="添加要点…"
          value={newPoint}
          maxLength={500}
          disabled={disabled}
          onChange={(e) => setNewPoint(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addPoint();
          }}
          className="flex-1 min-w-0 h-8 px-2 text-[13px] text-text-primary bg-card-solid/50 border border-border rounded-lg focus:outline-none focus:border-primary/60 placeholder:text-text-tertiary disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <Button variant="outline" onClick={addPoint} disabled={disabled || !newPoint.trim()}>
          +
        </Button>
      </div>
    </div>
  );
}
