/**
 * 讨论梳理画布页 - /discuss
 *
 * 左: 结构化画布(分组 → 要点),支持增删改、移动要点、重命名/删除分组
 * 右: 与 AI 逐轮讨论,AI 每轮自动把对话提炼成画布要点,并可按要求重组
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const MODES: Array<{ value: DiscussionMode; label: string; desc: string; emoji: string }> = [
  {
    value: 'business_model',
    label: '商业模式画布',
    desc: '经典 9 格画布:客户细分 / 价值主张 / 渠道 / 收入 / 成本等',
    emoji: '💼',
  },
  {
    value: 'lean_canvas',
    label: '精益画布',
    desc: '更聚焦创业验证:问题 / 解决方案 / 独特卖点 / 关键指标 / 壁垒',
    emoji: '🚀',
  },
  {
    value: 'swot',
    label: 'SWOT 分析',
    desc: '优势 / 劣势 / 机会 / 威胁,适合战略盘点',
    emoji: '⚖️',
  },
  {
    value: 'project',
    label: '软件项目要点',
    desc: '梳理项目目标 / 功能 / 场景 / 里程碑 / 风险等要点',
    emoji: '🛠️',
  },
  {
    value: 'free',
    label: '自由头脑风暴',
    desc: '不限框架,AI 随讨论自动组织分组',
    emoji: '💡',
  },
];

/** 统计画布要点总数(所有 group.points.length 之和) */
function totalPointCount(canvas: { groups: Array<{ points: unknown[] }> }): number {
  return canvas.groups.reduce((sum, g) => sum + g.points.length, 0);
}

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
 * 判断 current_step 是否处于"工具调用"阶段
 *
 * 后端文案有两种形式:
 *   - 单工具:  "正在执行 市场调研 工具..."
 *   - 多工具:  "正在并行执行 市场调研、竞品分析 工具:已返回 1/2..."
 * 后端 L572 注释明确说"以 '正在执行 X 工具' 开头,让 RunningStepChip 能识别",
 * 早期版本正则太严,漏了"并行"中间那个词,需放宽。
 */
function isToolStep(step: string): boolean {
  return /^正在(并行)?执行\s*.+?\s*工具/.test(step);
}

/**
 * 从工具阶段文案里提取出第一个工具名,用于紫色 chip 显示。
 * 例:
 *   "正在执行 市场调研 工具..."                  → "市场调研"
 *   "正在执行 市场调研 工具:正在抓取..."          → "市场调研"
 *   "正在并行执行 市场调研、竞品分析 工具..."     → "市场调研、竞品分析"
 *   "正在并行执行 市场调研、竞品分析 工具:1/2"     → "市场调研、竞品分析"
 */
function extractToolName(step: string): string {
  const m = step.match(/^正在(并行)?执行\s*(.+?)\s*工具/);
  return m ? m[2]!.trim() : '';
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

  // ---- 工作区左右分栏比例 + 可拖拽分隔条 ----
  // 左(画布)/右(对话)初始 60/40,允许用户拖拽自由调整;断点 lg(1024px)及以上才生效。
  // leftFr 是左栏占【剩宽度】(扣除分隔条 + 两侧 gap 后的可用区)的比例,clamp 在 [0.25, 0.85] 避免单边过窄。
  // v1.7+: 用 PointerEvent 统一处理鼠标 + 触摸 + 手写笔,平板/折叠屏下也能拖; leftFr 持久化到 localStorage。
  const SPLITTER_W = 8; // 分隔条 width=w-2
  const GAP_W = 8; // 父容器 gap-2,三列布局中首列后与末列前各有 1 个 gap
  const LEFT_FR_STORAGE_KEY = 'insignforge:discuss:leftFr:v1';
  const LEFT_FR_MIN = 0.25;
  const LEFT_FR_MAX = 0.85;
  const LEFT_FR_DEFAULT = 0.6;

  // 读取 localStorage 中的初始比例,带范围校验, 失败回退默认 0.6
  const [leftFr, setLeftFrState] = useState<number>(() => {
    if (typeof window === 'undefined') return LEFT_FR_DEFAULT;
    try {
      const raw = window.localStorage.getItem(LEFT_FR_STORAGE_KEY);
      if (!raw) return LEFT_FR_DEFAULT;
      const v = Number.parseFloat(raw);
      if (!Number.isFinite(v)) return LEFT_FR_DEFAULT;
      return Math.max(LEFT_FR_MIN, Math.min(LEFT_FR_MAX, v));
    } catch {
      // localStorage 可能被禁用(隐私模式 / 公司策略) → 静默走默认
      return LEFT_FR_DEFAULT;
    }
  });
  // setLeftFr 包装: 同步写 localStorage
  const setLeftFr = useCallback((value: number | ((prev: number) => number)) => {
    setLeftFrState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      const clamped = Math.max(LEFT_FR_MIN, Math.min(LEFT_FR_MAX, next));
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LEFT_FR_STORAGE_KEY, String(clamped));
        }
      } catch {
        /* 写入失败不影响 UI */
      }
      return clamped;
    });
  }, []);
  const [isLargeScreen, setIsLargeScreen] = useState(false);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const workAreaRef = useRef<HTMLDivElement>(null);
  // 节流参考时间戳(记录上次真正处理 move 的时间);初始 0 保证首次 pointermove 必过,避免按下后首帧跟丢手感。
  const splitterLastTickRef = useRef<number>(0);
  // 当前 pointer capture 的 id, 用以确保指针离开 splitter 时仍能收到 up/cancel 事件
  const activePointerIdRef = useRef<number | null>(null);

  // 监听断点: lg(1024px)及以上启用左右分栏 + 分隔条
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsLargeScreen(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 拖拽分隔条: 实时按指针 X 位置重新计算左栏比例
  // 计算公式: leftFr = (clientX - container.left - gap) / (container.width - splitter - gap*2)
  // 这样指针贴近分隔条时,左栏边缘也贴在指针处,避免“领先 14~18px”的手感偏差。
  // 用 PointerEvent 统一鼠标 + 触摸 + 笔;
  // setPointerCapture 之后指针离开 splitter 仍能收到 pointermove/pointerup(原始 mouseleave 会丢事件)。
  useEffect(() => {
    if (!isDraggingSplitter || !isLargeScreen) return;
    const handleMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - splitterLastTickRef.current < 16) return; // ~60fps 节流
      splitterLastTickRef.current = now;
      const el = workAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const usable = rect.width - SPLITTER_W - GAP_W * 2;
      if (usable <= 0) return;
      const ratio = (e.clientX - rect.left - GAP_W) / usable;
      setLeftFr(ratio);
    };
    const handleUp = (e: PointerEvent) => {
      // 仅处理与按下同一指针的 up, 避免其他手指误触
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      activePointerIdRef.current = null;
      setIsDraggingSplitter(false);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleUp);
    // 拖拽时禁止文本选中 + 改光标,体验更接近 IDE 分栏
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    // 某些触摸设备不会自动把 cursor 设为 col-resize,补充设置 touch-action 防止滚动
    document.body.style.touchAction = 'none';
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.body.style.touchAction = '';
    };
  }, [isDraggingSplitter, isLargeScreen, setLeftFr]);

  const handleSplitterDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    activePointerIdRef.current = e.pointerId;
    // 显式 capture,确保快速拖出元素也能收到后续 move/up
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境不支持,document 级监听会兜底 */
    }
    setIsDraggingSplitter(true);
  };

  // 键盘可访问性: ←→ 调整宽度(Shift 跳大点)、Home/End 跳到极值
  const handleSplitterKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.02;
    if (e.key === 'ArrowLeft') { setLeftFr((f: number) => f - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setLeftFr((f: number) => f + step); e.preventDefault(); }
    else if (e.key === 'Home') { setLeftFr(LEFT_FR_MIN); e.preventDefault(); }
    else if (e.key === 'End') { setLeftFr(LEFT_FR_MAX); e.preventDefault(); }
  };

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
                {sessions.map((s) => {
                  // 列表卡片:模式 emoji + 标题 + 要点数 / 对话数 / 更新时间
                  // 加 [空画布] 角标让用户一眼区分"刚创建还没讨论"与"已有内容"
                  const modeMeta = MODES.find((m) => m.value === s.mode);
                  const groupsCount = s.canvas.groups.length;
                  const pointsCount = totalPointCount(s.canvas);
                  const isEmptyCanvas = groupsCount === 0 || pointsCount === 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => void open(s.id)}
                      className="text-left p-3 border border-border rounded-lg hover:border-primary/50 hover:bg-hover-bg transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span aria-hidden className="shrink-0 text-base leading-none">
                            {modeMeta?.emoji ?? '📝'}
                          </span>
                          <span className="text-body text-text-primary font-medium truncate">
                            {s.title}
                          </span>
                        </span>
                        <span className="text-label text-text-secondary shrink-0">
                          {modeMeta?.label ?? s.mode}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-helper text-text-secondary flex-wrap">
                        <span className={isEmptyCanvas ? 'text-amber-400' : 'text-text-secondary'}>
                          {groupsCount} 组 · {pointsCount} 要点
                        </span>
                        {isEmptyCanvas && (
                          <span
                            title="画布为空——可能刚创建还没讨论,或讨论中 AI 未提取出要点"
                            className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-label"
                          >
                            空画布
                          </span>
                        )}
                        <span className="text-text-tertiary">·</span>
                        <span>{s.messages.length} 条对话</span>
                        <span className="text-text-tertiary">·</span>
                        <span className="text-text-tertiary">更新于 {new Date(s.updated_at).toLocaleString()}</span>
                      </div>
                    </button>
                  );
                })}
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
          // 展示后端写入的 current_step,而不是固定"分析中",避免长任务被误判为卡死。
          // key={job.current_step} 让阶段文案切换时重新挂载 RunningStepChip 实例,
          // 触发 current-step-fade 入场动画(否则 key 只能影响内部 span,不会触发重新挂载)
          //
          // 工具调用阶段视觉强化: 后端在工具调用循环里会写"正在执行 X 工具...",
          // 这里识别后给紫色工具 chip(符合 AI 助理紫色实线 chip 规范) + 🔧 图标,
          // 让用户一眼区分"AI 在思考"vs"AI 在主动调用工具做事"
          <RunningStepChip key={job.current_step} step={job.current_step} />
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

      <div
        ref={workAreaRef}
        className="flex-1 flex flex-col lg:flex-row gap-2 min-h-0"
      >
        {/* 画布 - 大屏占左、小屏占上(滚动容器由内层 CanvasPanel 负责) */}
        {/*
         * overflow-hidden 防止子元素的 box-shadow / sticky 边缘溢出圆角卡片边界;
         * 同时让左右两栏的滚动彻底隔离——之前在 lg 以下宽度变化时,
         * 右栏 overflow-y-auto 可能因为外层滚动穿透导致画布跟着上下动,
         * 加了 overflow-hidden + min-h-0 之后内外滚动各管各的。
         */}
        <div
          className="flex flex-col min-h-0 w-full lg:w-auto overflow-hidden"
          style={isLargeScreen ? { flex: `${leftFr} 1 0%`, minWidth: 0 } : undefined}
        >
          <div className="flex items-center justify-between mb-2 shrink-0">
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
          <div className="flex-1 min-h-0 overflow-hidden">
            <CanvasPanel session={session} onApply={onApply} disabled={anyRunning} />
          </div>
        </div>

        {/* 可拖拽分隔条 - 仅 lg 及以上屏幕显示 */}
        {isLargeScreen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整左右窗口宽度"
            aria-valuenow={Math.round(leftFr * 100)}
            aria-valuemin={25}
            aria-valuemax={85}
            tabIndex={0}
            title="拖拽或按 ←→ 调整宽度"
            onPointerDown={handleSplitterDown}
            onKeyDown={handleSplitterKeyDown}
            className={`group relative w-2 shrink-0 cursor-col-resize flex items-center justify-center rounded transition-colors outline-none focus-visible:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/40 ${
              isDraggingSplitter ? 'bg-primary/30' : 'hover:bg-primary/15'
            }`}
          >
            {/* 拖拽手柄(中间 1px 实线) - 默认 30% 透明、hover/拖拽时变亮 */}
            <span
              className={`block w-px h-full transition-colors ${
                isDraggingSplitter ? 'bg-primary' : 'bg-border group-hover:bg-primary/60'
              }`}
            />
          </div>
        )}

        {/* 对话 - 大屏占右、小屏占下 */}
        {/*
         * overflow-hidden + sticky 标题:
         * - 防止 box-shadow / sticky 边缘溢出圆角卡片
         * - 长对话时"与 AI 讨论"标题始终钉在右栏顶部,
         *   不会随对话滚动被挤出视口
         */}
        <div
          className="bg-card backdrop-blur-xl border border-border rounded-card shadow-glass flex flex-col min-h-0 w-full lg:w-auto overflow-hidden"
          style={isLargeScreen ? { flex: `${1 - leftFr} 1 0%`, minWidth: 0 } : undefined}
        >
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-border text-body text-text-primary font-medium bg-card-solid/95 backdrop-blur">
            与 AI 讨论
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-[240px] xl:min-h-0">
            {session.messages.length === 0 && !running && (
              <div className="text-helper text-text-secondary my-auto text-center">
                在下方输入你的想法,AI 会把讨论提炼成画布要点
              </div>
            )}
            {session.messages.map((m, i) => (
              <ChatBubble
                key={`${m.created_at}-${i}`}
                role={m.role}
                content={m.content}
                createdAt={m.created_at}
                onCopied={() => setNotice('已复制到剪贴板')}
              />
            ))}
            {/*
              AI 在跑的时候直接在对话气泡列表最末尾加进度反馈:
              1. 工具调用阶段(/^正在执行\s*(.+?)\s*工具/): 显示"讨论加载面板"
                 - 阶段时间线(6 个阶段) + ETA + 已耗时
                 - 与首页调研过渡页 ResearchLoadingPanel 体验对齐
              2. 其他阶段: 显示 RunningStepBubble 阶段气泡
              这样用户视线一直在对话区,不会错过进度。
            */}
            {running && isToolStep(job.current_step) && (
              <DiscussionLoadingPanel
                step={job.current_step}
                startedAt={job.started_at}
              />
            )}
            {running && !isToolStep(job.current_step) && (
              <RunningStepBubble
                key={job.current_step}
                step={job.current_step}
                startedAt={job.started_at}
              />
            )}
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
 *
 * 历史阶段回放: 后端在【调研数据】消息顶部会写一行 `> 🔧 来源工具: 市场调研、竞品分析`,
 * 这里检测后渲染为气泡上方的独立紫色 chip,hover 时显示完整工具列表与原始时间。
 * 这样用户阅读历史 AI 回应时,可以一眼看出哪些回复由实时工具数据生成。
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

  // 匹配后端写入的工具来源行(只在 AI 消息上检测)
  const sourceMatch = !isUser ? content.match(/^> 🔧 来源工具:([^\n]+)\n\n/) : null;
  const sourceTools = sourceMatch ? sourceMatch[1]!.trim() : null;
  // 渲染气泡内容时去掉来源行(避免用户看到原始 Markdown 引用语法)
  const displayContent = sourceMatch ? content.slice(sourceMatch[0].length) : content;

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
        {/* 历史阶段回放: 工具来源 chip(独立于气泡上方,区分 AI 助理亲自生成 vs 实时工具数据) */}
        {sourceTools && (
          <span
            title={`本轮调用了${sourceTools}获取实时数据 · 生成于 ${new Date(createdAt).toLocaleString()}`}
            aria-label={`来源工具:${sourceTools}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-helper rounded-md border border-violet-500/50 bg-violet-500/10 text-violet-300 max-w-full"
          >
            <span aria-hidden className="shrink-0 text-[12px] leading-none">🔧</span>
            <span className="truncate">来源工具:{sourceTools}</span>
          </span>
        )}
        <div
          className={`relative px-3 py-2 text-[14px] leading-6 whitespace-pre-wrap rounded-lg ${
            isUser
              ? 'bg-gradient-to-r from-primary to-primary-dark text-white'
              : 'bg-hover-bg text-text-primary'
          }`}
        >
          {displayContent}
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
    <div className="bg-card backdrop-blur-xl border border-border rounded-card shadow-glass flex flex-col min-h-0 overflow-hidden">
      {/* sticky 标题: 长画布滚动时"要点画布 / N 个要点"始终钉在顶部 */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-card-solid/95 backdrop-blur">
        <h2 className="text-body text-text-primary font-medium">要点画布</h2>
        <span className="text-label text-text-secondary">
          {totalPointCount(session.canvas)} 个要点
        </span>
      </div>

      {/*
        flex-1 + overflow-y-auto 让画布内容独立滚动,
        与右栏对话滚动完全隔离(配合外层 overflow-hidden 一起防穿透)。
        "新增分组"留在滚动区末尾,跟随画布走而不是铺在视口底部,
        避免遮挡最后一个分组卡片。
      */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        {session.canvas.groups.length === 0 ? (
          <div className="text-helper text-text-secondary my-auto text-center py-12">
            画布为空。在右侧和 AI 讨论,或在下方直接创建分组
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start">
            {/* 画布默认在左栏(占 60%),在 lg 及以上整体页面变左右双栏后,左栏宽度有限,
                用 md:grid-cols-2 让卡片在中宽度及以上始终两列展示,避免单列上下堆叠占满屏高。
                xl 以上如果用户把画布拉到很宽,再触发 3 列(此时画布宽度足够,不会拥挤)。 */}
            {session.canvas.groups.map((g) => (
              <GroupCard key={g.id} group={g} groups={session.canvas.groups} onApply={onApply} disabled={disabled} />
            ))}
          </div>
        )}

        {/* 新增分组 */}
        <div className="flex gap-2">
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

/**
 * 运行中阶段提示 chip - 区分"AI 在思考"与"AI 在主动调用工具"
 *
 * 后端在 DiscussionService.runChat 里会按以下 6 个细粒度阶段写 current_step:
 *   1. 正在提炼要点并重组画布...
 *   2. AI 正在判断是否需要调用调研工具...
 *   3. AI 决定调用 {市场调研、竞品分析} 工具...
 *   4. 正在执行 市场调研 工具...     ← 工具调用循环,会逐个工具切换
 *   5. 调研数据已收集,正在整合生成结论...
 *   6. 正在梳理并更新画布...          (无工具路径)
 *
 * 阶段 4 用正则 /^正在执行\s*(.+?)\s*工具/ 识别,渲染为紫色工具 chip(符合 AI 助理紫色实线 chip 规范)
 * 其他阶段保持普通主色调文本。
 *
 * key={step} 让阶段文案切换时重新挂载,配合 .current-step-fade 动画呈现"换阶段了"的视觉反馈。
 */
function RunningStepChip({ step }: { step: string }) {
  const safeStep = step || 'AI 分析中';
  const toolMatch = safeStep.match(/^正在执行\s*(.+?)\s*工具/);
  const isToolStep = toolMatch !== null;
  const toolName = isToolStep && toolMatch ? toolMatch[1]! : '';
  const displayText = isToolStep ? `${toolName} 工具调用中` : safeStep;

  return (
    <span
      title={safeStep}
      className={
        isToolStep
          // 紫色实线 chip + 🔧 图标,和 AI 助理 chip 视觉规范对齐(border-violet-500/50 + #8B5CF6)
          ? 'inline-flex items-center gap-1.5 min-w-0 max-w-[320px] current-step-fade px-2 py-0.5 rounded-md border border-violet-500/50 bg-violet-500/10 text-violet-300'
          : 'text-helper text-primary inline-flex items-center gap-1 min-w-0 max-w-[280px] current-step-fade'
      }
    >
      {isToolStep && (
        <span aria-hidden className="shrink-0 text-[13px] leading-none">
          🔧
        </span>
      )}
      <span className="truncate">{displayText}</span>
      <span className="dot-1">.</span>
      <span className="dot-2">.</span>
      <span className="dot-3">.</span>
    </span>
  );
}

/**
 * 跑阶段中加载气泡 - 直接挂在对话列表末尾,作为"AI 正在回复"的占位气泡
 *
 * 与 RunningStepChip 的区别:
 * - Chip 是头部那个小小的,容易被忽略
 * - Bubble 是聊天气泡样式,直接出现在对话区,用户视线一直在那里看得到
 *
 * 工具调用阶段(/^正在执行\s*(.+?)\s*工具/)会显示紫色 🔧 chip,
 * 与报告页/调研页的 AI 助理芯片视觉一致;
 * 普通思考阶段使用普通主色调文本。
 *
 * key={step} 让阶段文案切换时重新挂载,触发 .current-step-fade 动画,
 * 配合呼吸点让用户看到"换阶段了"。
 *
 * 自动滚动: 每次 step 变化时滚到视口里,让用户看到最新进度;
 * 如果用户在滚上面的历史对话(向上滚),则不抢焦点(只在本来就在底部时滚动)。
 */
function RunningStepBubble({ step, startedAt }: { step: string; startedAt: string }) {
  const safeStep = step || 'AI 分析中';
  // 用顶层 isToolStep / extractToolName 复用同一套正则,
  // 确保三个入口(这里的 chip 颜色、DiscussionLoadingPanel 的工具名、L1111 的分流判断)严格一致
  const inToolPhase = isToolStep(safeStep);
  const toolName = inToolPhase ? extractToolName(safeStep) : '';
  const displayText = inToolPhase ? `${toolName} 工具调用中` : safeStep;
  const bubbleRef = useRef<HTMLDivElement>(null);

  // 已耗时:每秒刷新。startedAt 为空时降级为 0 秒 + 额外提示
  const [elapsed, setElapsed] = useState(0);
  const [hasStartedAt, setHasStartedAt] = useState(() => Boolean(new Date(startedAt).getTime()));
  useEffect(() => {
    const startMs = new Date(startedAt).getTime();
    if (!startMs) return;
    setHasStartedAt(true);
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  // 阶段切换时滚到气泡可见。
  // 智能抢焦点:只有用户当前在对话列表底部(距底部 ≤ 120px)时才滚,
  // 避免用户在读历史时被拉回去。
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scroller) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
      return;
    }
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom <= 120) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [step]);

  // startedAt 缺失时(后端还没写入 started_at 字段就被前端轮询到),
  // 避免 UI 卡在 "已思考 0 秒"误导用户以为 AI 没启动。
  const elapsedText = !hasStartedAt
    ? '准备中'
    : elapsed < 60
      ? `${elapsed} 秒`
      : `${Math.floor(elapsed / 60)} 分 ${(elapsed % 60).toString().padStart(2, '0')} 秒`;

  return (
    <div ref={bubbleRef} className="flex justify-start">
      <div className="max-w-[88%] flex flex-col gap-1 items-start">
        <div
          className={
            inToolPhase
              // 工具阶段: 紫色实线 chip + 🔧,与 AI 助理视觉一致
              ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-violet-500/50 bg-violet-500/10 text-violet-200 current-step-fade'
              // 普通阶段: 玻璃拟态气泡 + 主色文本 + 三点呼吸
              : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-hover-bg text-text-primary border border-border current-step-fade'
          }
        >
          {inToolPhase ? (
            <>
              <span aria-hidden className="shrink-0 text-[14px] leading-none">🔧</span>
              <span className="text-[14px] leading-6">{displayText}</span>
              <span className="dot-1">.</span>
              <span className="dot-2">.</span>
              <span className="dot-3">.</span>
            </>
          ) : (
            <>
              <span aria-hidden className="shrink-0 text-primary-light text-[14px] leading-none">
                ✦
              </span>
              <span className="text-[14px] leading-6">{displayText}</span>
              <span className="dot-1">.</span>
              <span className="dot-2">.</span>
              <span className="dot-3">.</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-label text-text-tertiary opacity-80">
          <span>已思考 {elapsedText}</span>
          {inToolPhase && (
            <span
              title="AI 正在调用实时数据工具,这一步通常较久(10-30s),请耐心等待"
              className="text-violet-300/80"
            >
              · 实时数据采集中
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 讨论加载面板(简化版 ResearchLoadingPanel)
 *
 * 当 AI 在讨论中调用实时数据工具(市场调研 / 竞品分析)时,
 * 在对话列表末尾显示这块面板,提供与首页调研过渡页一致的反馈:
 *   - 6 阶段时间线(提炼要点 → 判断调工具 → 决定调什么 → 调工具 → 整合 → 梳理画布)
 *   - ETA(剩余时间估算,基于已耗时 + 阶段位置)
 *   - 已耗时(每秒刷新)
 *   - 当前工具紫色 chip(让用户知道 AI 在干什么)
 *
 * 与 ResearchLoadingPanel 的差异:
 *   - 讨论任务没有 ExecutionMetrics(没有数据瀑布 / 数据源指标),
 *     因为 DiscussionService.runChat 不写 metrics
 *   - 阶段名称为讨论场景定制,不是调研场景
 *
 * 设计原则:放在对话列表底部作为"AI 正在回复"的视觉占位,
 * 避免头部 chip 被用户忽略、让用户随时看到 AI 在干什么。
 */
/**
 * 讨论任务 6 阶段识别表。
 *
 * 关键词匹配顺序重要——detectDiscussionStageIndex 是顺序 for 循环,
 * 先匹配先生效。所以提取阶段的关键词不能和后续阶段重叠。
 *
 * 背景: 后端文案实际可能为:
 *   1. 正在提炼要点并重组画布...            ← extract
 *   2. AI 正在判断是否需要调用调研工具...   ← judge
 *   3. AI 决定调用 X、Y 工具...             ← decide
 *   4. 正在执行 X 工具...                   ← runTool
 *      正在并行执行 X、Y 工具:已返回 N/M...  ← runTool (并行版本)
 *   5. 调研数据已收集,正在整合生成结论...   ← merge
 *      正在整合调研数据生成结论...          ← merge
 *   6. 正在梳理并更新画布...                ← update (无工具路径最后一步)
 *
 * 早期版本中 extract 和 update 都含 "梳理并更新画布", 会让最后一步被错误识别为 stage 0,
 * 导致 ETA 退化为 elapsed/0.05 = 19 倍膨胀，用户在 AI 快完成时反而看到 "还要 9 分 30 秒"。
 */
const DISCUSSION_STAGES: ReadonlyArray<{ id: string; label: string; keywords: ReadonlyArray<string> }> = [
  { id: 'extract', label: '提炼要点', keywords: ['提炼要点'] },
  { id: 'judge', label: '判断调工具', keywords: ['判断是否需要调用调研工具', '判断是否调用'] },
  { id: 'decide', label: '决定调哪些', keywords: ['决定调用'] },
  { id: 'runTool', label: '调工具采数据', keywords: ['正在执行', '正在并行执行'] },
  { id: 'merge', label: '整合生成', keywords: ['整合生成', '调研数据已收集', '正在整合'] },
  { id: 'update', label: '梳理画布', keywords: ['梳理并更新画布', '梳理要点'] },
];

/** 从 current_step 推断当前阶段索引(0-based)。找不到匹配返回 0。 */
function detectDiscussionStageIndex(step: string): number {
  const text = (step ?? '').toLowerCase();
  if (!text.trim()) return 0;
  for (let i = 0; i < DISCUSSION_STAGES.length; i++) {
    if (DISCUSSION_STAGES[i]!.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      return i;
    }
  }
  return 0;
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return s === 0 ? `${m} 分钟` : `${m} 分 ${s.toString().padStart(2, '0')} 秒`;
}

function DiscussionLoadingPanel({ step, startedAt }: { step: string; startedAt: string }) {
  const panelRef = useRef<HTMLDivElement>(null);

  // 已耗时
  const [elapsed, setElapsed] = useState(0);
  const [hasStartedAt, setHasStartedAt] = useState(() => Boolean(new Date(startedAt).getTime()));
  useEffect(() => {
    const startMs = new Date(startedAt).getTime();
    if (!startMs) return;
    setHasStartedAt(true);
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  // 当前阶段
  const stageIndex = useMemo(() => detectDiscussionStageIndex(step), [step]);
  const stageTotal = DISCUSSION_STAGES.length;

  // ETA: 启动 10s 内样本不足 → 显示“计算中”;
  // 阶段位置加权外推(已走阶段 / 总阶段)。
  // 重要: stageIndex=0 时退化为 elapsed/0.05 = 20 倍,在 ETA 面板里体现为 "还有很久",
  // 提醒用户“还在第一阶段”。这是设计选择的输出，不需要“保护默认 0”——后端应保证
  // 阶段文案要么为空(此时 stageIndex=0 + elapsed 本身也趋近 0),要么明确属于某个阶段。
  const eta = useMemo(() => {
    if (elapsed < 10) return null;
    if (stageIndex >= stageTotal - 1) return 0;
    const finishedRatio = Math.max(0.05, stageIndex / stageTotal);
    const totalEstimated = elapsed / finishedRatio;
    return Math.max(0, totalEstimated - elapsed);
  }, [elapsed, stageIndex, stageTotal]);

  // 阶段切换时滚到面板可见。
  // 智能抢焦点:仅当用户当前在对话列表底部(≤ 120px)时才滚,避免读历史时被拉回。
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scroller) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
      return;
    }
    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom <= 120) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [step]);

  // 提取当前工具名——复用顶层 extractToolName,
  // 与 RunningStepBubble 同一套正则,接受单工具和"并行 X、Y"两种格式。
  const toolName = extractToolName(step);

  return (
    <div
      ref={panelRef}
      className="bg-card backdrop-blur-xl border border-violet-500/30 rounded-card p-4 shadow-glass"
    >
      {/* 标题 + 紫色工具 chip */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-violet-300 stage-pulse"
          title="AI 在调工具"
        >
          <span className="text-[14px] leading-none">🔧</span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-section font-semibold text-text-primary leading-tight flex items-center gap-2">
            AI 正在调用实时数据工具
            {toolName && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-violet-500/50 bg-violet-500/15 text-violet-200 text-label font-normal">
                {toolName}
              </span>
            )}
          </h3>
          <p className="text-helper text-text-secondary mt-1">
            {step}
            <span className="dot-1">.</span>
            <span className="dot-2">.</span>
            <span className="dot-3">.</span>
          </p>
        </div>
      </div>

      {/* 进度指标条: 已耗时 / 阶段 / 剩余 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-helper text-text-secondary tabular-nums">
        <span>
          <span className="text-text-tertiary">已耗时</span>{' '}
          <span className="text-text-primary">{hasStartedAt ? formatElapsed(elapsed) : '准备中'}</span>
        </span>
        <span className="text-text-tertiary">·</span>
        <span>
          <span className="text-text-tertiary">阶段</span>{' '}
          <span className="text-text-primary">
            {Math.min(stageIndex + 1, stageTotal)} / {stageTotal}
          </span>
        </span>
        <span className="text-text-tertiary">·</span>
        <span>
          <span className="text-text-tertiary">剩余</span>{' '}
          <span className="text-primary-light">
            {eta === null
              ? '计算中…'
              : stageIndex >= stageTotal - 1
                ? '即将完成'
                : `约 ${formatElapsed(eta)}`}
          </span>
        </span>
      </div>

      {/* 6 阶段时间线 */}
      <ol className="mt-4 grid grid-cols-6 gap-1.5" aria-label="讨论阶段进度">
        {DISCUSSION_STAGES.map((stage, idx) => {
          const isDone = idx < stageIndex;
          const isCurrent = idx === stageIndex;
          const isPending = idx > stageIndex;
          return (
            <li
              key={stage.id}
              className="flex flex-col items-center gap-1 min-w-0"
              title={stage.label}
            >
              <div className="relative w-full h-1 rounded-full bg-border overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 ${
                    isDone
                      ? 'w-full bg-emerald-500/70'
                      : isCurrent
                        ? 'w-1/2 bg-violet-400'
                        : 'w-0'
                  }`}
                />
              </div>
              <div
                className={[
                  'inline-flex h-5 w-5 items-center justify-center rounded-full text-label leading-none transition-colors',
                  isDone
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : isCurrent
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40 stage-pulse'
                      : 'bg-bg-secondary text-text-tertiary border border-border',
                ].join(' ')}
              >
                {isDone ? '✓' : isCurrent ? '●' : idx + 1}
              </div>
              <span
                className={`text-label leading-tight text-center w-full truncate ${
                  isDone
                    ? 'text-emerald-400'
                    : isCurrent
                      ? 'text-violet-300'
                      : 'text-text-tertiary'
                }`}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
