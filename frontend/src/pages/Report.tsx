/**
 * 报告页 - 按前端设计文档 §3.2
 * 卡片分组:执行摘要 / 热度数字 / 竞品 / 痛点 / 风险机会 / 数据来源
 * v1.0.1 新增:导出 Markdown / 导出 PDF(后者在后端未配置 Chromium 时降级到浏览器打印)
 * v1.1 优化:目录导航 / 竞品优劣势 / 热度可视化 / 可行性评分 / 竞品对比矩阵 /
 *            重新调研 / JSON 导出 / 分享功能 / 落地页生成
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { LlmSetupPrompt } from '../components/LlmSetupPrompt';
import { TechSelectionModal } from '../components/TechSelectionModal';
import { FrontendDesignModal } from '../components/FrontendDesignModal';
import { useDialog } from '../components/Dialog';
import { Banner } from '../components/Banner';
import { Dropdown } from '../components/Dropdown';
import { JobProgressItem } from '../components/JobProgressItem';
import { ReportToc } from '../components/ReportToc';
import { Tooltip } from '../components/Tooltip';
import { ResearchLoadingPanel } from '../components/ResearchLoadingPanel';
import { SourceContributionCard } from '../components/SourceContributionCard';
import { Container } from '../components/Container';
import { PaperSizePicker } from '../components/PaperSizePicker';
import { SectionAnnotation } from '../components/SectionAnnotation';
import { api } from '../lib/api';
import { useResearch } from '../hooks/useResearch';
import { useDesktopApi } from '../hooks/useDesktopApi';
import { explainError } from '../lib/errorMessages';
import { applyPaperSize, loadPdfPreferences } from '../lib/pdfPreferences';
import { getLlmProvider } from '../lib/llmProviders';
import type {
  DocsJob,
  BpJob,
  BpJobStatus,
  MarketReport,
  Project,
  ReportCompetitor,
  TechStackPlan,
  FrontendDesignPlan,
  DocVersion,
  HistoryArchives,
  LlmStatus,
} from '../types';

/**
 * 触发浏览器下载指定 Blob
 * 使用 <a download> + ObjectURL,避免打开新窗口
 * 注意:Electron 主进程会弹出"保存对话框",期间 blob 必须存活;
 *      因此延迟较久才 revoke,避免下载失败。
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // 延迟 revoke(2 分钟): 保证 Electron 保存对话框期间 blob 数据源仍有效
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 120_000);
}

/**
 * 直接触发后端下载 URL(相对路径)
 * 不走 blob: 主进程弹出保存对话框期间,HTTP 流不会因 revokeObjectURL 而失效
 */
function downloadUrl(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = ''; // 空 download 属性 → 使用后端 Content-Disposition 的中文文件名
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

/** 开发文档轮询间隔 */
const DOCS_POLL_INTERVAL = 4000;

/** 商业计划书轮询间隔 */
const BP_POLL_INTERVAL = 4000;

/** 目录章节定义 - 顺序与报告正文渲染顺序一致 */
const TOC_SECTIONS = [
  { id: 'section-summary', label: '执行摘要' },
  { id: 'section-feasibility', label: '可行性评分' },
  { id: 'section-recommendation', label: '行动建议' },
  { id: 'section-heat', label: '市场热度' },
  { id: 'section-competitors', label: '竞品识别' },
  { id: 'section-compare', label: '竞品对比矩阵' },
  { id: 'section-pain', label: '用户痛点' },
  { id: 'section-market-size', label: '市场规模' },
  { id: 'section-risk-opp', label: '风险与机会' },
  { id: 'section-sources', label: '数据来源' },
];

/**
 * 计算可行性评分(基于报告数据的启发式算法)
 * 综合考虑:市场热度、竞争烈度、痛点强度、机会数量
 */
function calcFeasibilityScore(report: MarketReport): {
  score: number;
  level: 'high' | 'medium' | 'low';
  breakdown: { label: string; score: number; weight: number }[];
} {
  const heat = report.market_heat.heat_score;
  const competitorCount = report.competitors.length;
  const painCount = report.pain_points.length;
  const oppCount = report.opportunities.length;
  const riskCount = report.risks.length;

  // 热度分(权重 35%)
  const heatScore = heat;
  // 竞争烈度:竞品越少分越高(权重 20%)
  const competitionScore = Math.max(0, 100 - competitorCount * 15);
  // 痛点强度:痛点越多需求越明确(权重 20%)
  const painScore = Math.min(100, painCount * 14);
  // 机会空间:机会越多越好(权重 15%)
  const oppScore = Math.min(100, oppCount * 20);
  // 风险系数:风险越少越好(权重 10%)
  const riskScore = Math.max(0, 100 - riskCount * 18);

  const breakdown = [
    { label: '市场热度', score: heatScore, weight: 0.35 },
    { label: '竞争空间', score: competitionScore, weight: 0.20 },
    { label: '需求强度', score: painScore, weight: 0.20 },
    { label: '机会数量', score: oppScore, weight: 0.15 },
    { label: '风险可控', score: riskScore, weight: 0.10 },
  ];

  const total = breakdown.reduce((sum, b) => sum + b.score * b.weight, 0);
  const score = Math.round(total);

  let level: 'high' | 'medium' | 'low' = 'medium';
  if (score >= 70) level = 'high';
  else if (score < 40) level = 'low';

  return { score, level, breakdown };
}

/**
 * 生成行动建议(基于报告数据的规则引擎)
 * 不依赖 LLM,纯前端根据数据特征生成建议
 */
function generateRecommendations(report: MarketReport): string[] {
  const recs: string[] = [];
  const { heat_score, trend } = report.market_heat;

  // 基于热度趋势
  if (trend === 'rising') {
    recs.push('市场处于上升期,建议尽快切入抢占早期用户心智。');
  } else if (trend === 'declining') {
    recs.push('市场呈下降趋势,建议谨慎进入,或寻找细分转型机会。');
  } else {
    recs.push('市场趋于平稳,建议通过差异化功能切入存量竞争。');
  }

  // 基于竞争烈度
  if (report.competitors.length <= 2) {
    recs.push('竞品较少,市场格局未定,是建立品牌认知的好时机。');
  } else if (report.competitors.length >= 5) {
    recs.push('竞品较多,建议聚焦一个细分场景做深做透,避免正面竞争。');
  }

  // 基于痛点
  if (report.pain_points.length >= 5) {
    recs.push(`用户痛点明确(${report.pain_points.length}条),建议优先解决Top 3痛点验证PMF。`);
  }

  // 基于机会
  if (report.opportunities.length > 0) {
    recs.push(`建议优先验证:"${report.opportunities[0]}" 作为核心差异化方向。`);
  }

  // 基于风险
  if (report.risks.length >= 3) {
    recs.push('风险因素较多,建议先做最小可行性验证(MVP),控制投入成本。');
  }

  // 热度评分
  if (heat_score >= 80) {
    recs.push('市场热度很高,建议加大投入快速推进,抓住窗口期。');
  } else if (heat_score < 40) {
    recs.push('市场热度偏低,建议先验证真实需求,避免过早投入开发。');
  }

  return recs.slice(0, 5); // 最多 5 条
}

/** 环形进度条组件 - 纯 SVG 实现,无外部依赖 */
function RingProgress({
  score,
  size = 120,
  strokeWidth = 10,
  label,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  // 根据分数变色
  let color = '#6366F1'; // indigo
  if (score >= 70) color = '#10B981'; // emerald
  else if (score < 40) color = '#EF4444'; // red

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(148, 163, 184, 0.2)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-text-primary">{score}</span>
        {label && <span className="text-xs text-text-secondary mt-0.5">{label}</span>}
      </div>
    </div>
  );
}

/**
 * 数据范围提示卡(用于“市场规模”节)
 * - ok=true: 绿色对勾
 * - ok=false + always=true: 始终提示(口径提示)
 * - ok=false: 橙黄色提醒(数据可能不全)
 */
function RangeChip({
  label,
  ok,
  okText,
  hintText,
  always,
}: {
  label: string;
  ok: boolean;
  okText: string;
  hintText: string;
  always?: boolean;
}) {
  const cls = ok
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : always
      ? 'border-primary/30 bg-primary/10 text-primary-light'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return (
    <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${cls}`}>
      <span aria-hidden>{ok ? '✅' : always ? '📌' : '⚠'}</span>
      <div className="leading-tight">
        <div className="text-helper text-text-secondary">{label}</div>
        <div className="text-helper font-medium">{ok ? okText : always ? okText : hintText}</div>
      </div>
    </div>
  );
}

/** 趋势迷你图组件 - 纯 SVG */
function TrendSparkline({ trend }: { trend: 'rising' | 'stable' | 'declining' }) {
  const points = useMemo(() => {
    const base = 30;
    if (trend === 'rising') {
      return [
        [5, base + 15],
        [15, base + 10],
        [25, base + 5],
        [35, base - 2],
        [45, base - 8],
        [55, base - 15],
        [65, base - 20],
        [75, base - 25],
      ];
    } else if (trend === 'declining') {
      return [
        [5, base - 25],
        [15, base - 20],
        [25, base - 15],
        [35, base - 8],
        [45, base - 2],
        [55, base + 5],
        [65, base + 10],
        [75, base + 15],
      ];
    }
    // stable
    return [
      [5, base],
      [15, base + 3],
      [25, base - 2],
      [35, base + 1],
      [45, base - 1],
      [55, base + 2],
      [65, base - 3],
      [75, base],
    ];
  }, [trend]);

  const color =
    trend === 'rising' ? '#10B981' : trend === 'declining' ? '#EF4444' : '#94A3B8';

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
    .join(' ');

  return (
    <svg width="80" height="40" viewBox="0 0 80 50" className="inline-block">
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Report() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dialog = useDialog();
    /** v1.8 P0-A3: 集中消费桌面端 API,避免散落 window.insightforge?.openPath / saveDir */
    const desktop = useDesktopApi();
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 导出中状态:'md'/'pdf'/'json'/null */
  const [exportBusy, setExportBusy] = useState<null | 'md' | 'pdf' | 'json'>(null);
  /** 导出进度(导出进行中才有值) - 用于顶部进度条显示阶段与耗时 */
  const [exportProgress, setExportProgress] = useState<
    { format: 'md' | 'pdf' | 'json'; startedAt: number; phase: 'connecting' | 'generating' | 'downloading' } | null
  >(null);
  /** 导出已完成(成功后短暂提示 2s 后消失) */
  const [exportResult, setExportResult] = useState<{ format: 'md' | 'pdf' | 'json'; ts: number } | null>(null);
  /** 导出已耗时秒数(每秒 +1) */
  const [exportElapsed, setExportElapsed] = useState(0);
  /** 开发文档生成状态(未触发为 null) */
  const [docsJob, setDocsJob] = useState<DocsJob | null>(null);
  /** 开发文档相关错误文案 */
  const [docsError, setDocsError] = useState<string | null>(null);
  /** 开发文档下载中(用于按钮 loading) */
  const [docsDownloading, setDocsDownloading] = useState(false);
  /** 开发文档轮询定时器句柄 */
  const docsTimerRef = useRef<number | null>(null);
  /** 商业计划书生成状态(未触发为 null) */
  const [bpJob, setBpJob] = useState<BpJob | null>(null);
  /** 商业计划书相关错误文案 */
  const [bpError, setBpError] = useState<string | null>(null);
  /** 商业计划书"另存"操作中(用于按钮 loading) */
  const [bpSaving, setBpSaving] = useState(false);
  /** 商业计划书轮询定时器句柄 */
  const bpTimerRef = useRef<number | null>(null);
  /** 复制成功提示 */
  const [copySuccess, setCopySuccess] = useState(false);
  /** 落地页预览弹窗 */
  const [landingPreview, setLandingPreview] = useState<string | null>(null);
  /** 落地页生成中 */
  const [landingLoading, setLandingLoading] = useState(false);
  /** v1.7.1 FR-14: 落地页生成配置(CTA / 表单字段 / 主题),空值时后端走智能默认 */
  const [landingConfig, setLandingConfig] = useState<{
    call_to_action: string;
    call_to_action_subtext: string;
    success_message: string;
    theme: 'light' | 'dark';
    fields: Array<{
      name: string;
      type: 'email' | 'phone' | 'text';
      label: string;
      placeholder: string;
      required: boolean;
    }>;
  }>({
    call_to_action: '',
    call_to_action_subtext: '',
    success_message: '',
    theme: 'light',
    fields: [
      { name: 'email', type: 'email', label: '邮箱', placeholder: 'your@email.com', required: true },
    ],
  });
  /** v1.7.1 FR-13: 当前落地页生成插件元信息(由后端返回时由前端记录) */
  const [landingPlugin, setLandingPlugin] = useState<{
    id: string;
    name: string;
    version: string;
    source: 'builtin' | 'dsh' | 'external';
    priority: number;
  } | null>(null);
  /** 重新调研确认弹窗 */
  const [showReResearch, setShowReResearch] = useState(false);
  /** 进一步探讨: 正在创建讨论会话 */
  const [discussing, setDiscussing] = useState(false);
  /** 技术选型弹窗 */
  const [showTechSelection, setShowTechSelection] = useState(false);
  /** 前端设计方案弹窗 */
  const [showFrontendDesign, setShowFrontendDesign] = useState(false);
  /** 已选技术栈方案 */
  const [selectedTechPlan, setSelectedTechPlan] = useState<TechStackPlan | null>(null);
  /** 已选前端设计方案 */
  const [selectedDesignPlan, setSelectedDesignPlan] = useState<FrontendDesignPlan | null>(null);
  /** 文档版本选择弹窗 */
  const [showVersionSelect, setShowVersionSelect] = useState(false);
  /** 当前选择的文档版本 */
  const [docVersion, setDocVersion] = useState<DocVersion>('full');
  /** 商业模式描述(用于 MVP 版本) */
  const [businessModel, setBusinessModel] = useState('');
  /** 历史文档归档(项目名 -> 已生成文档列表),用于左侧"已生成文档" */
  const [archives, setArchives] = useState<HistoryArchives>({});
  /** v1.8 P3-A 信任感: 当前 LLM 提供商 + 模型(供报告页头部信任头展示) */
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  /** 复制并重新调研 - 加载中状态(置于顶层 hooks 区,避免与其他 useEffect 交错导致顺序不一致) */
  const [duplicating, setDuplicating] = useState(false);
  /** v1.8 P6-B: wait_and_retry 倒计时(秒),>0 表示正在倒计时,0 表示未启动 */
  const [waitCountdown, setWaitCountdown] = useState(0);

  const {
    status,
    report,
    loading,
    error,
    errorCode,
    retryAttempt,
    trigger,
    retry,
    reset,
  } = useResearch();

  useEffect(() => {
    if (!id) return;
    reset();
    setDocsJob(null);
    setDocsError(null);
    setBpJob(null);
    setBpError(null);
    setLandingPreview(null);
    if (docsTimerRef.current !== null) {
      window.clearInterval(docsTimerRef.current);
      docsTimerRef.current = null;
    }
    if (bpTimerRef.current !== null) {
      window.clearInterval(bpTimerRef.current);
      bpTimerRef.current = null;
    }

    /** 在当前 useEffect 中可复用的轮询函数 */
    const pollDocs = async (): Promise<void> => {
      try {
        const job = await api.getDocsStatus(id);
        setDocsJob(job);
        if (job.status === 'running') {
          // 继续轮询
        } else if (job.status === 'success') {
          if (docsTimerRef.current !== null) {
            window.clearInterval(docsTimerRef.current);
            docsTimerRef.current = null;
          }
        } else if (job.status === 'failed') {
          setDocsError(job.error_message ?? '生成失败');
          if (docsTimerRef.current !== null) {
            window.clearInterval(docsTimerRef.current);
            docsTimerRef.current = null;
          }
        }
      } catch (err) {
        // 轮询中可能后端 job 被清理,静默忽略
        if (docsTimerRef.current !== null) {
          window.clearInterval(docsTimerRef.current);
          docsTimerRef.current = null;
        }
      }
    };

    const pollBp = async (): Promise<void> => {
      try {
        const job = await api.getBpStatus(id);
        setBpJob(job);
        if (job.status === 'running') {
          // 继续轮询
        } else if (job.status === 'success') {
          if (bpTimerRef.current !== null) {
            window.clearInterval(bpTimerRef.current);
            bpTimerRef.current = null;
          }
        } else if (job.status === 'failed') {
          setBpError(job.error_message ?? '生成失败');
          if (bpTimerRef.current !== null) {
            window.clearInterval(bpTimerRef.current);
            bpTimerRef.current = null;
          }
        }
      } catch (err) {
        // 轮询中可能后端 job 被清理,静默忽略
        if (bpTimerRef.current !== null) {
          window.clearInterval(bpTimerRef.current);
          bpTimerRef.current = null;
        }
      }
    };

    (async () => {
      try {
        const p = await api.getProject(id);
        setProject(p);
        if (p.report) {
          // 已有报告,直接展示
        } else if (p.status !== 'analyzing') {
          // 启动调研
          await trigger(p.id);
        } else {
          // 正在调研,继续轮询
          await trigger(p.id);
        }
        // 尝试恢复已有的开发文档任务状态(后端内存中的 job)
        try {
          const existing = await api.getDocsStatus(id);
          setDocsJob(existing);
          if (existing.status === 'running') {
            docsTimerRef.current = window.setInterval(pollDocs, DOCS_POLL_INTERVAL);
          }
        } catch {
          // 404 = 尚未触发,忽略
        }
        // 尝试恢复已有的商业计划书任务状态(后端内存中的 job)
        try {
          const existingBp = await api.getBpStatus(id);
          setBpJob(existingBp);
          if (existingBp.status === 'running') {
            bpTimerRef.current = window.setInterval(pollBp, BP_POLL_INTERVAL);
          }
        } catch {
          // 404 = 尚未触发,忽略
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      if (docsTimerRef.current !== null) {
        window.clearInterval(docsTimerRef.current);
        docsTimerRef.current = null;
      }
      if (bpTimerRef.current !== null) {
        window.clearInterval(bpTimerRef.current);
        bpTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 加载历史文档归档(左侧边栏"已生成文档"列表)
  useEffect(() => {
    api.getArchives().then(setArchives).catch(() => {
      // 归档目录不存在等场景静默忽略
    });
  }, []);

  // v1.8 P3-A 信任感: 加载当前 LLM 状态,供报告页头部「生成模型」展示
  useEffect(() => {
    api
      .getLlmStatus()
      .then((s) => setLlmStatus(s))
      .catch(() => {
        // 桌面端首次启动 LLM 未配置等场景静默忽略,头部不展示模型名
      });
  }, []);

  // v1.7.1 FR-13: 加载当前生效的落地页插件(供 Modal 头部展示)
  useEffect(() => {
    api
      .listPlugins()
      .then((plugins) => {
        // 选 priority 最高的 enabled 插件
        const enabled = plugins.filter((p) => p.enabled);
        if (enabled.length === 0) return;
        enabled.sort((a, b) => b.priority - a.priority);
        const top = enabled[0];
        if (top) {
          setLandingPlugin({
            id: top.id,
            name: top.name,
            version: top.version,
            source: top.source,
            priority: top.priority,
          });
        }
      })
      .catch(() => {
        // 后端不可用静默
      });
  }, []);

  // 导出进度计时器:exportProgress 非空时,每秒 +1 显示已用秒数
  useEffect(() => {
    if (exportProgress === null) {
      setExportElapsed(0);
      return;
    }
    setExportElapsed(0);
    const timer = window.setInterval(() => {
      setExportElapsed((v) => v + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [exportProgress]);

  // 导出成功结果 2 秒后自动清除
  useEffect(() => {
    if (exportResult === null) return;
    const timer = window.setTimeout(() => setExportResult(null), 2000);
    return () => window.clearTimeout(timer);
  }, [exportResult]);

  // v1.8 P6-B: wait_and_retry 倒计时驱动 — 错误码是 SOURCE_RATE_LIMIT / SOURCE_CIRCUIT_OPEN
  // 时,友好错误结构会自带 wait_and_retry action。errorCode 变化触发后启动一个
  // setInterval(1s)逐秒减 1;归零后自动调用 retry()。
  // 错误清除(error 变 null)时主动重置回 0,避免下次报错从上次的残余值起步。
  useEffect(() => {
    if (!error || !errorCode) {
      setWaitCountdown(0);
      return;
    }
    const friendly = explainError(errorCode, error);
    const action = friendly.action;
    if (action?.type !== 'wait_and_retry') {
      setWaitCountdown(0);
      return;
    }
    setWaitCountdown(action.seconds);
    const timer = window.setInterval(() => {
      setWaitCountdown((s) => {
        if (s <= 1) {
          window.clearInterval(timer);
          // 倒计时归零 -> 自动重试
          void retry();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // 仅在错误码变化时重启倒计时;error / retry 函数引用变化不重启
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorCode]);

  // 商业计划书刚生成成功时,自动用系统默认应用打开首份 md 预览(仅桌面端)
  // 仅当状态从 running → success 切换时才触发,避免重新进入页面时重复弹预览。
  const bpPrevStatusRef = useRef<BpJobStatus | null>(null);
  useEffect(() => {
    if (!bpJob) return;
    const prev = bpPrevStatusRef.current;
    bpPrevStatusRef.current = bpJob.status;
    if (
      prev === 'running' &&
      bpJob.status === 'success' &&
      bpJob.archive_path &&
      desktop.isDesktop
    ) {
      // 异步打开,不阻塞后续逻辑
      const sep = desktop.platform === 'darwin' ? '/' : '\\';
      void desktop.openPath(`${bpJob.archive_path}${sep}00-封面与目录.md`);
    }
  }, [bpJob?.status, bpJob?.archive_path, desktop.isDesktop, desktop.platform]);

  const isCompleted = report !== null;
  const isAnalyzing = loading && !report;
  const currentReport: MarketReport | null = report ?? project?.report ?? null;

  // 当前项目已生成的历史文档归档(左侧"已生成文档"列表)
  const projectArchive = useMemo(() => {
    if (!project) return undefined;
    return archives[sanitizeArchiveKey(project.name)];
  }, [archives, project]);

  // 计算可行性评分
  const feasibility = useMemo(() => {
    if (!currentReport) return null;
    return calcFeasibilityScore(currentReport);
  }, [currentReport]);

  // 生成行动建议
  const recommendations = useMemo(() => {
    if (!currentReport) return [];
    return generateRecommendations(currentReport);
  }, [currentReport]);

  // 滚动到指定章节
  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // 复制摘要到剪贴板
  const copySummary = async () => {
    if (!currentReport || !project) return;
    const text = `【${project.name}】市场调研摘要\n\n${currentReport.summary}\n\n热度评分:${currentReport.market_heat.heat_score}/100\n竞品数量:${currentReport.competitors.length}个\n用户痛点:${currentReport.pain_points.length}条\n\n—— 由 InsightForge 生成`;
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // 降级方案 - 用 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  // v1.8 P4-B: 复制桌面应用深链 insightforge://report/<projectId>
  // 桌面版安装后,点击该链接会被 Electron 拉起并跳转到本报告页。
  // Web 端点击会触发"选择应用"对话框,提示安装桌面版。
  const copyDeepLink = async () => {
    if (!id) return;
    const deepLink = `insightforge://report/${id}`;
    try {
      await navigator.clipboard.writeText(deepLink);
    } catch {
      // 降级到 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = deepLink;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // 生成二维码(使用公共 API 的 data URL 方案,纯前端不依赖外部)
  // 这里用简单的文本分享链接方式,实际二维码可用 qrcode.js 库
  const shareLink = async () => {
    if (!id) return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 非安全上下文或权限被拒绝:降级到 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // 生成落地页(v1.7.1 FR-14: 把 landingConfig 一并带上)
  const handleGenerateLanding = async () => {
    if (!id) return;
    setLandingLoading(true);
    try {
      // 仅传非默认值,避免无谓的请求体体积
      const c = landingConfig;
      const overrides: Parameters<typeof api.generateLanding>[1] = {};
      if (c.theme !== 'light') overrides.theme = c.theme;
      if (c.call_to_action.trim()) overrides.call_to_action = c.call_to_action.trim();
      if (c.call_to_action_subtext.trim())
        overrides.call_to_action_subtext = c.call_to_action_subtext.trim();
      if (c.success_message.trim()) overrides.success_message = c.success_message.trim();
      // 表单字段: 只有当用户实际调整时才覆盖
      const defaultFields = [
        { name: 'email', type: 'email' as const, label: '邮箱', placeholder: 'your@email.com', required: true },
      ];
      const eq = (a: typeof defaultFields[0], b: typeof defaultFields[0]) =>
        a.name === b.name && a.type === b.type && a.label === b.label &&
        (a.placeholder ?? '') === (b.placeholder ?? '') && a.required === b.required;
      const fieldsSame =
        c.fields.length === defaultFields.length &&
        c.fields.every((f, i) => eq(f, defaultFields[i]!));
      if (!fieldsSame) {
        overrides.form_fields = c.fields.map((f) => ({
          name: f.name,
          type: f.type,
          label: f.label,
          placeholder: f.placeholder || undefined,
          required: f.required,
        }));
      }
      const result = await api.generateLanding(id, overrides);
      if (result && typeof result === 'object' && 'html' in (result as object)) {
        setLandingPreview((result as { html: string }).html);
      } else {
        await dialog.alert({
          title: '生成失败',
          message: (result as { message?: string }).message ?? '生成失败',
          tone: 'danger',
        });
      }
    } catch (err) {
      await dialog.alert({
        title: '生成失败',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setLandingLoading(false);
    }
  };

  // 下载落地页 HTML
  const downloadLanding = () => {
    if (!landingPreview || !project) return;
    const blob = new Blob([landingPreview], { type: 'text/html;charset=utf-8' });
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'landing';
    downloadBlob(blob, `${safeName}-落地页.html`);
  };

  // 导出 JSON
  const handleExportJson = async () => {
    if (!id || !currentReport || !project) return;
    setExportBusy('json');
    try {
      const data = {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          keywords: project.keywords,
          created_at: project.created_at,
        },
        report: currentReport,
        feasibility: feasibility
          ? {
              score: feasibility.score,
              level: feasibility.level,
              breakdown: feasibility.breakdown,
            }
          : null,
        recommendations,
        generated_at: new Date().toISOString(),
        generator: 'InsightForge',
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'report';
      downloadBlob(blob, `${safeName}-报告数据.json`);
    } finally {
      setExportBusy(null);
    }
  };

  // 重新调研
  const handleReResearch = async () => {
    if (!id) return;
    setShowReResearch(false);
    reset();
    await trigger(id);
  };

  // 复制并重新调研 - 基于现有项目描述创建全新项目,保留原始报告
  const handleDuplicate = async () => {
    if (!project || duplicating) return;
    setDuplicating(true);
    try {
      const dup = await api.createProject(
        project.description,
        `${project.name} (副本)`
      );
      // 跳转到新项目页后,自动开始调研
      navigate(`/report/${dup.id}`);
      // 后台跳转,不要 await,避免错误传递给调用者
      void trigger(dup.id).catch(() => {
        // 错误由 hook 内部 state 管理,无需额外处理
      });
    } catch (err) {
      await dialog.alert({
        title: '复制失败',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setDuplicating(false);
    }
  };

  /** 用系统默认程序打开归档文件(桌面端) */
  const openArchiveFile = async (file: string) => {
    if (!projectArchive) return;
    if (!desktop.isDesktop) {
      await dialog.alert({
        title: '桌面端专属功能',
        message: '仅桌面端支持直接打开归档文件。',
        tone: 'warning',
      });
      return;
    }
    const sep = desktop.platform === 'darwin' ? '/' : '\\';
    const fullPath = `${projectArchive.dir}${sep}${file}`;
    const res = await desktop.openPath(fullPath);
    if (!res?.ok) {
      await dialog.alert({
        title: '打开失败',
        message: `打开失败:${res?.message ?? '未知错误'}`,
        tone: 'danger',
      });
    }
  };

  /** 进一步探讨: 基于报告上下文创建讨论会话并跳转 */
  const handleFurtherDiscuss = async () => {
    if (!id || !currentReport || !project) return;
    setDiscussing(true);
    try {
      const r = currentReport;
      const context = [
        '我们刚完成了一轮市场调研,报告核心结论如下:',
        '',
        `【执行摘要】${r.summary}`,
        `【市场热度】${r.market_heat.heat_score}/100 · 趋势 ${
          r.market_heat.trend === 'rising' ? '上升' : r.market_heat.trend === 'declining' ? '下降' : '平稳'
        } · 月搜索量 ${r.market_heat.search_volume.toLocaleString()}`,
        `【竞品】${
          r.competitors.length
            ? r.competitors.map((c) => `${c.name}(${c.description})`).join('; ')
            : '暂无'
        }`,
        `【用户痛点】${r.pain_points.length ? r.pain_points.join('; ') : '暂无'}`,
        `【市场规模】${r.market_size}`,
        `【风险】${r.risks.length ? r.risks.join('; ') : '暂无'}`,
        `【机会】${r.opportunities.length ? r.opportunities.join('; ') : '暂无'}`,
        '',
        '请基于这份报告和我进一步深入探讨:目标客户定位、商业模式、MVP 范围、下一步行动等。先给我一份初步分析,再提出最需要澄清的 2-3 个问题。',
      ].join('\n');
      const res = await api.createDiscussion({
        title: `${project.name} - 进一步探讨`,
        mode: 'business_model',
        projectId: project.id,
        message: context.slice(0, 2000),
      });
      navigate(`/discuss/${res.session.id}`);
    } catch (err) {
      await dialog.alert({
        title: '创建讨论失败',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
      setDiscussing(false);
    }
  };

  if (loadError) {
    return (
      <Container size="md">
        <Card>
          <div className="text-red-600">加载失败:{loadError}</div>
          <div className="mt-4">
            <Button variant="text" onClick={() => navigate('/')}>
              ← 返回首页
            </Button>
          </div>
        </Card>
      </Container>
    );
  }

  return (
    <div className="flex-1 flex">
      {/* 左侧目录导航 - 桌面端显示 */}
      {currentReport && (
        <aside className="hidden lg:block w-56 flex-shrink-0 no-print">
          <div className="sticky top-24 ml-6">
            <div className="text-sm font-medium text-text-secondary mb-3">目录</div>
            <nav className="space-y-1">
              {TOC_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className="block w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:text-primary-light hover:bg-primary/10 rounded-lg transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </nav>
            <div className="mt-6 pt-4 border-t border-border">
              <Button
                variant="outline"
                className="w-full text-sm h-9"
                onClick={() => setShowReResearch(true)}
              >
                🔄 重新调研
              </Button>
            </div>

            {/* 已生成文档列表(桌面端历史文档归档) */}
            {projectArchive && projectArchive.files.length > 0 && (
              <div className="mt-6 pt-4 border-t border-border">
                <div className="text-sm font-medium text-text-secondary mb-2">
                  已生成文档
                </div>
                <ul className="space-y-1">
                  {projectArchive.files.map((file) => (
                    <li key={file}>
                      <button
                        type="button"
                        onClick={() => void openArchiveFile(file)}
                        title={`打开 ${file}`}
                        className="block w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:text-primary-light hover:bg-primary/10 rounded-lg transition-colors truncate"
                      >
                        📄 {truncateDocName(file)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* 主内容区 */}
      <Container size="md">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="text" onClick={() => navigate('/')}>
            ← 返回首页
          </Button>
          {project && (
            <div className="flex items-center gap-2">
              <span className="text-helper text-text-secondary">{project.name}</span>
              <StatusBadge kind={statusKind(project.status)} />
            </div>
          )}
        </div>

        {/* v1.8 P3-A 信任感: 报告页头部「生成时间 / 数据源 / 生成模型」一行信任头
             - 报告未生成时不渲染(避免出现「暂无」之类的错价信息)
             - 同比采取屏幕阅读器友好(以列表语义呈现 3 项) */}
        {currentReport && (
          <ul
            className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-helper text-text-secondary"
            aria-label="报告元信息"
          >
            {/* 生成时间 */}
            {currentReport.generated_at && (
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden className="opacity-70">🕐</span>
                <span>
                  生成于{' '}
                  <time dateTime={currentReport.generated_at} className="text-text-primary font-medium">
                    {formatReportTime(currentReport.generated_at)}
                  </time>
                </span>
              </li>
            )}
            {/* 数据源 */}
            {currentReport.contributions && currentReport.contributions.length > 0 && (
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden className="opacity-70">📚</span>
                <span>
                  数据源{' '}
                  <span className="text-text-primary font-medium">
                    {currentReport.contributions.length} 个
                  </span>
                  {' / '}
                  合计{' '}
                  <span className="text-text-primary font-medium">
                    {currentReport.contributions.reduce((acc, c) => acc + c.count, 0)} 条
                  </span>
                </span>
              </li>
            )}
            {/* 生成模型 */}
            {llmStatus && (
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden className="opacity-70">🤖</span>
                <span>
                  生成模型{' '}
                  <span className="text-text-primary font-medium" title={llmStatus.model}>
                    {getLlmProvider(llmStatus.provider)?.label ?? llmStatus.provider} · {llmStatus.model}
                  </span>
                </span>
              </li>
            )}
          </ul>
        )}

        {isAnalyzing && (
          // vNext: 走马灯 + 阶段时间线 + ETA + 数据瀑布,替代原先简化的
          // <Card title="调研分析中..."><ResearchProgress/></Card>。
          // 设计目标见 ResearchLoadingPanel 顶部注释。
          <ResearchLoadingPanel
            progress={status?.progress ?? '准备中...'}
            currentStep={status?.execution.current_step ?? ''}
            startedAt={status?.execution.started_at ?? new Date().toISOString()}
            metrics={status?.execution.metrics ?? null}
          />
        )}

        {/* 后台任务进度聚合 - 开发文档 / 商业计划书 */}
        {(docsJob || bpJob) && (
          <div className="my-6 space-y-3">
            {docsJob && (
              <JobProgressItem
                label={`${docsJob.version === 'mvp' ? 'MVP' : '完整'}开发文档`}
                status={
                  docsJob.status === 'success' && docsJob.filenames.length === 0
                    ? 'idle'
                    : docsJob.status
                }
                currentStep={docsJob.current_step}
                progress={docsJob.progress}
                total={docsJob.total}
                progressText={`${docsJob.progress} / ${docsJob.total}`}
                startedAt={docsJob.started_at ?? undefined}
                fileCount={docsJob.filenames.length}
                fileTotal={docsJob.total}
                archivePath={docsJob.archive_path ?? undefined}
                errorMessage={docsError ?? undefined}
                primaryLabel="下载开发文档包"
                primaryLoading={docsDownloading}
                primaryDisabled={exportBusy !== null}
                onPrimary={() => void handleGenerateDocs()}
                retryLabel="重新生成"
                onRetry={() => handleGenerateDocs()}
              />
            )}
            {docsJob && docsJob.status === 'success' && docsJob.filenames.length > 0 && (
              <details className="bg-card/50 border border-border rounded-card px-4 py-2">
                <summary className="cursor-pointer text-helper text-text-secondary hover:text-text-primary">
                  查看文件列表 ({docsJob.filenames.length})
                </summary>
                <div className="mt-2 text-helper text-text-secondary space-y-1">
                  {(selectedTechPlan || selectedDesignPlan) && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {selectedTechPlan && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                          技术栈: {selectedTechPlan.plan_name}
                        </span>
                      )}
                      {selectedDesignPlan && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                          设计: {selectedDesignPlan.plan_name}
                        </span>
                      )}
                    </div>
                  )}
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    {docsJob.filenames.map((fn) => (
                      <li key={fn} className="truncate">
                        · {fn}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
            {bpJob && (
              <JobProgressItem
                label="商业计划书"
                status={
                  bpJob.status === 'success' && bpJob.filenames.length === 0
                    ? 'idle'
                    : bpJob.status
                }
                currentStep={bpJob.current_step}
                progress={bpJob.progress}
                total={bpJob.total}
                progressText={`${bpJob.progress} / ${bpJob.total}`}
                startedAt={bpJob.started_at ?? undefined}
                fileCount={bpJob.filenames.length}
                fileTotal={bpJob.total}
                archivePath={bpJob.archive_path ?? undefined}
                errorMessage={bpError ?? undefined}
                primaryLabel="另存商业计划书"
                primaryLoading={bpSaving}
                primaryDisabled={exportBusy !== null}
                onPrimary={() => void handleGenerateBp()}
                retryLabel="重新生成"
                onRetry={() => handleGenerateBp()}
              />
            )}
            {bpJob && bpJob.status === 'success' && bpJob.filenames.length > 0 && (
              <details className="bg-card/50 border border-border rounded-card px-4 py-2">
                <summary className="cursor-pointer text-helper text-text-secondary hover:text-text-primary">
                  查看文件列表 ({bpJob.filenames.length})
                </summary>
                <div className="mt-2 text-helper text-text-secondary">
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    {bpJob.filenames.map((fn) => (
                      <li key={fn} className="truncate">
                        · {fn}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </div>
        )}

        {/* 调研失败 Banner - 展示友好错误信息,提供手动重试入口(v1.3 友好化)
             v1.7 增强: 根据 friendly.action 派发跳转「设置」/「历史」
             v1.8 P6-B 增强: 当 friendly.action.type === 'wait_and_retry' 时,
             显示倒计时进度条 + 「立即重试」手动按钮(不依赖倒计时) */}
        {error && (() => {
          const friendly = explainError(errorCode, error);
          const showRetry = friendly.retryable && retryAttempt === 0;
          // 与 friendly.action 互不冲突: 如果只是 retryable, 只有“重试”按钮;
          // 如果有 action, 则额外增加一个跳转按钮(如“去设置”)。
          // 如果 action 类型是 retry 以外, 则隐藏默认的重试按钮以免冗余。
          let actionLabel: string | undefined;
          let actionHandler: (() => void) | undefined;
          let hideDefaultRetry = false;
          switch (friendly.action?.type) {
            case 'go_settings':
              actionLabel = '去设置';
              actionHandler = () => navigate('/settings');
              hideDefaultRetry = true; // 跳转才是主操作,不重复
              break;
            case 'go_history':
              actionLabel = '查看历史';
              actionHandler = () => navigate('/history');
              hideDefaultRetry = true;
              break;
            case 'wait_and_retry':
              // 倒计时模式下不走默认 Banner 按钮,由下方 countdown UI 接管
              hideDefaultRetry = true;
              break;
            // 'retry' 与默认重试按钮重复, 不重复渲染
            default:
              break;
          }
          const action = actionLabel && actionHandler
            ? { label: actionLabel, onClick: actionHandler }
            : undefined;
          const waitAction = friendly.action?.type === 'wait_and_retry' ? friendly.action : null;
          return (
            <div className="my-6">
              <Banner
                tone="error"
                title={friendly.title}
                action={
                  // 优先级: action(去设置/历史) > 重试
                  action ??
                  (showRetry && !hideDefaultRetry
                    ? { label: '重试', onClick: () => void retry() }
                    : undefined)
                }
              >
                {friendly.detail}
                {/* v1.8 P6-B: wait_and_retry 倒计时 UI — 限流 / 熔断场景 */}
                {waitAction && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-helper">
                      <span aria-hidden className="animate-pulse">⏱</span>
                      <span>
                        {waitCountdown > 0 ? (
                          <>
                            将在 <span className="text-text-primary font-semibold tabular-nums">{waitCountdown}</span> 秒后自动重试
                          </>
                        ) : (
                          <>正在触发重试…</>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void retry()}
                        className="ml-auto text-primary hover:underline"
                      >
                        立即重试
                      </button>
                    </div>
                    <div
                      className="h-1 bg-border rounded-full overflow-hidden"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={waitAction.seconds}
                      aria-valuenow={waitCountdown}
                    >
                      <div
                        className="h-full bg-primary transition-all duration-1000 ease-linear"
                        style={{
                          width: `${waitAction.seconds > 0 ? (waitCountdown / waitAction.seconds) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {retryAttempt > 0 && (
                  <div className="mt-2 text-text-secondary">
                    🔄 正在自动重试 ({retryAttempt} / 3)…
                  </div>
                )}
              </Banner>
            </div>
          );
        })()}

        {currentReport && (
          <>
            {/* 章节导航 - 横向滚动胶囊,移动端友好 */}
            <ReportToc items={TOC_SECTIONS} />

            {/* 章节断点辅助样式:让每个 section 之间有明显的视觉分隔,便于长报告扫读 */}
            {/* 1. 执行摘要 - 顶部不需断点 */}
            <section id="section-summary" className="mb-6">
              <Card
                title="执行摘要"
                action={
                  <SectionAnnotation
                    projectId={id ?? ''}
                    sectionKey="section-summary"
                    sectionLabel="执行摘要"
                  />
                }
              >
                <p className="text-body text-text-primary leading-relaxed">
                  {currentReport.summary}
                </p>
              </Card>
            </section>

            {/* 2. 市场热度 - 可视化增强 */}
            <section id="section-heat" className="mt-10 pt-8 border-t border-border/30">
              <Card
                title="市场热度"
                action={
                  <SectionAnnotation
                    projectId={id ?? ''}
                    sectionKey="section-heat"
                    sectionLabel="市场热度"
                  />
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="text-helper text-text-secondary mb-2">搜索热度</div>
                    <div className="text-[32px] font-semibold text-text-primary">
                      {currentReport.market_heat.search_volume.toLocaleString()}
                    </div>
                    <div className="text-helper text-text-secondary mt-1">月搜索量</div>
                  </div>
                  <div className="text-center">
                    <div className="text-helper text-text-secondary mb-2">讨论量</div>
                    <div className="text-[32px] font-semibold text-text-primary">
                      {currentReport.market_heat.discussion_count.toLocaleString()}
                    </div>
                    <div className="text-helper text-text-secondary mt-1">来自社区</div>
                  </div>
                  <div className="text-center">
                    <div className="text-helper text-text-secondary mb-2">热度评分</div>
                    <RingProgress
                      score={currentReport.market_heat.heat_score}
                      size={80}
                      strokeWidth={8}
                    />
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-border flex items-center justify-center gap-3">
                  <span className="text-helper text-text-secondary">趋势:</span>
                  <TrendSparkline trend={currentReport.market_heat.trend} />
                  <span
                    className={`text-sm font-medium ${
                      currentReport.market_heat.trend === 'rising'
                        ? 'text-emerald-400'
                        : currentReport.market_heat.trend === 'declining'
                        ? 'text-red-400'
                        : 'text-text-secondary'
                    }`}
                  >
                    {currentReport.market_heat.trend === 'rising'
                      ? '↑ 上升'
                      : currentReport.market_heat.trend === 'declining'
                      ? '↓ 下降'
                      : '→ 平稳'}
                  </span>
                </div>
              </Card>
            </section>

            {/* 3. 可行性评分 */}
            {feasibility && (
              <section id="section-feasibility" className="mt-10 pt-8 border-t border-border/30">
                <Card
                  title={
                    <span className="inline-flex items-center gap-2">
                      可行性评分
                      <Tooltip
                        placement="right"
                        content={
                          <div className="space-y-1">
                            <div className="font-medium text-text-primary">
                              算法说明
                            </div>
                            <div className="text-text-secondary leading-relaxed">
                              基于报告数据启发式打分 (0-100):
                              市场热度 + 竞争烈度 + 痛点强度 + 机会数量
                              四个维度的加权平均。
                            </div>
                            <div className="text-text-tertiary pt-1">
                              ≥70 推荐进入 · 40-69 谨慎进入 · &lt;40 不推荐
                            </div>
                          </div>
                        }
                      >
                        <button
                          type="button"
                          aria-label="评分算法说明"
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-helper text-text-tertiary hover:text-primary hover:bg-primary/10 transition-colors cursor-help"
                        >
                          ⓘ
                        </button>
                      </Tooltip>
                    </span>
                  }
                  action={
                    <SectionAnnotation
                      projectId={id ?? ''}
                      sectionKey="section-feasibility"
                      sectionLabel="可行性评分"
                    />
                  }
                >
                  <div className="flex flex-col md:flex-row items-center gap-6">
                    <div className="flex-shrink-0">
                      <RingProgress
                        score={feasibility.score}
                        size={140}
                        strokeWidth={12}
                        label={
                          feasibility.level === 'high'
                            ? '推荐进入'
                            : feasibility.level === 'medium'
                            ? '谨慎进入'
                            : '不推荐'
                        }
                      />
                    </div>
                    <div className="flex-1 w-full">
                      <div className="space-y-2">
                        {feasibility.breakdown.map((b) => (
                          <div key={b.label} className="flex items-center gap-3">
                            <span className="text-sm text-text-secondary w-20 flex-shrink-0">
                              {b.label}
                            </span>
                            <div className="flex-1 bg-slate-700/50 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-gradient-to-r from-primary to-accent h-full rounded-full transition-all"
                                style={{ width: `${b.score}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-text-primary w-10 text-right">
                              {b.score}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </section>
            )}

            {/* 4. 行动建议 - 前置,让读者先拿到"该不该做/怎么开始"的答案 */}
            {recommendations.length > 0 && (
              <section
                id="section-recommendation"
                className="mt-10 pt-8 border-t border-border/30"
              >
                <Card
                  title="行动建议"
                  tone="primary"
                  action={
                    <SectionAnnotation
                      projectId={id ?? ''}
                      sectionKey="section-recommendation"
                      sectionLabel="行动建议"
                    />
                  }
                >
                  <div className="space-y-3">
                    {recommendations.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-3 bg-primary/10 rounded-lg border border-primary/20"
                      >
                        <span className="text-primary-light font-bold flex-shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-text-primary">{r}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-helper text-text-secondary">
                    * 建议由系统基于报告数据自动生成,仅供参考
                  </div>
                </Card>
              </section>
            )}

            {/* 5. 竞品识别 - 补全优劣势 */}
            <section id="section-competitors" className="mt-10 pt-8 border-t border-border/30">
              <Card
                title="竞品识别"
                action={
                  <SectionAnnotation
                    projectId={id ?? ''}
                    sectionKey="section-competitors"
                    sectionLabel="竞品识别"
                  />
                }
              >
                {currentReport.competitors.length === 0 ? (
                  <div className="text-helper text-text-secondary">暂无数据</div>
                ) : (
                  <ul className="space-y-4">
                    {currentReport.competitors.map((c, i) => (
                      <li
                        key={i}
                        className="border border-border rounded-lg p-4 bg-card-solid/30 backdrop-blur-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-text-primary">
                            {c.name}
                            {c.url && (
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 text-primary text-helper hover:underline"
                              >
                                官网 →
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="text-helper text-text-secondary mt-1">
                          {c.description}
                        </div>
                        {(c.strengths?.length || c.weaknesses?.length) && (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {c.strengths && c.strengths.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-emerald-400 mb-1">
                                  ✓ 优势
                                </div>
                                <ul className="space-y-0.5">
                                  {c.strengths.map((s, si) => (
                                    <li
                                      key={si}
                                      className="text-helper text-text-secondary pl-3 relative"
                                    >
                                      <span className="absolute left-0 text-emerald-400">
                                        ·
                                      </span>
                                      {s}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {c.weaknesses && c.weaknesses.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-red-400 mb-1">
                                  ✗ 劣势
                                </div>
                                <ul className="space-y-0.5">
                                  {c.weaknesses.map((w, wi) => (
                                    <li
                                      key={wi}
                                      className="text-helper text-text-secondary pl-3 relative"
                                    >
                                      <span className="absolute left-0 text-red-400">
                                        ·
                                      </span>
                                      {w}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* 5. 竞品对比矩阵 - v1.6 增强: 桌面表格 + 移动卡片双视图
                设计动机: 5 列在 <768px 上被挤压,横向滚动需要左手按住。
                设计: md 以上表格,md 以下为「每个竞品一张卡片」的堆叠。 */}
            {currentReport.competitors.length >= 2 && (
              <section id="section-compare" className="mt-10 pt-8 border-t border-border/30">
                <Card
                  title="竞品对比矩阵"
                  action={
                    <SectionAnnotation
                      projectId={id ?? ''}
                      sectionKey="section-compare"
                      sectionLabel="竞品对比矩阵"
                    />
                  }
                >
                  {/* 桌面端表格 (md+) */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-card-solid/50">
                          <th className="text-left p-2 border-b border-border font-medium text-text-secondary">
                            维度
                          </th>
                          {currentReport.competitors.map((c, i) => (
                            <th
                              key={i}
                              className="text-left p-2 border-b border-border font-medium text-text-primary min-w-[140px]"
                            >
                              {c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="p-2 border-b border-border text-text-secondary font-medium">
                            描述
                          </td>
                          {currentReport.competitors.map((c, i) => (
                            <td key={i} className="p-2 border-b border-border text-text-primary">
                              {c.description}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="p-2 border-b border-border text-text-secondary font-medium">
                            核心优势
                          </td>
                          {currentReport.competitors.map((c, i) => (
                            <td key={i} className="p-2 border-b border-border">
                              {c.strengths?.length ? (
                                <ul className="space-y-0.5">
                                  {c.strengths.map((s, si) => (
                                    <li key={si} className="text-emerald-400 text-helper">
                                      ✓ {s}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-text-secondary text-helper">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="p-2 border-b border-border text-text-secondary font-medium">
                            主要不足
                          </td>
                          {currentReport.competitors.map((c, i) => (
                            <td key={i} className="p-2 border-b border-border">
                              {c.weaknesses?.length ? (
                                <ul className="space-y-0.5">
                                  {c.weaknesses.map((w, wi) => (
                                    <li key={wi} className="text-red-400 text-helper">
                                      ✗ {w}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-text-secondary text-helper">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="p-2 text-text-secondary font-medium">官网</td>
                          {currentReport.competitors.map((c, i) => (
                            <td key={i} className="p-2">
                              {c.url ? (
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline text-helper break-all"
                                >
                                  访问 →
                                </a>
                              ) : (
                                <span className="text-text-secondary text-helper">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* 移动端卡片堆叠 (<md) */}
                  <div className="md:hidden space-y-4">
                    {currentReport.competitors.map((c, i) => (
                      <div
                        key={i}
                        className="border border-border rounded-lg p-4 bg-card-solid/30"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="font-medium text-text-primary">{c.name}</div>
                          {c.url && (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary text-helper hover:underline shrink-0"
                            >
                              官网 →
                            </a>
                          )}
                        </div>
                        <div className="text-helper text-text-secondary mb-3">{c.description}</div>
                        {c.strengths && c.strengths.length > 0 && (
                          <div className="mb-2">
                            <div className="text-helper font-medium text-emerald-400 mb-1">
                              ✓ 优势
                            </div>
                            <ul className="space-y-0.5 text-helper text-text-primary">
                              {c.strengths.map((s, si) => (
                                <li key={si}>· {s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {c.weaknesses && c.weaknesses.length > 0 && (
                          <div>
                            <div className="text-helper font-medium text-red-400 mb-1">
                              ✗ 劣势
                            </div>
                            <ul className="space-y-0.5 text-helper text-text-primary">
                              {c.weaknesses.map((w, wi) => (
                                <li key={wi}>· {w}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </section>
            )}

            {/* 6. 用户痛点 */}
            <section id="section-pain" className="mt-10 pt-8 border-t border-border/30">
              <Card
                title="用户痛点"
                action={
                  <SectionAnnotation
                    projectId={id ?? ''}
                    sectionKey="section-pain"
                    sectionLabel="用户痛点"
                  />
                }
              >
                {currentReport.pain_points.length === 0 ? (
                  <div className="text-helper text-text-secondary">暂无数据</div>
                ) : (
                  <ul className="space-y-2">
                    {currentReport.pain_points.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-400 mt-1 flex-shrink-0">!</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            {/* 7. 市场规模 - v1.6 增强: 数字+单位+基线年可视化提示,避免"约 8.5 亿"无锚点
                实现思路:
                  - 主文本直接 LLM 原文
                  - 在右侧/下方浮一个"📌 数据范围"提示卡,显式声明估算口径
                  - 数字粒度提示:含"亿/万/¥/$/%/千/百万"等单位关键字时打勾,缺单位时给警告
                v1.8 P4-A 增强: 文本下方追加"📊 推断详情"行,枚举检测到的币种 / 年份 / 量级 token,
                  把抽象的"是否含单位"变成"具体检测到 USD / 2026 / 亿", 读者一眼看到锚点。 */}
            {(() => {
              const text = currentReport.market_size ?? '';
              // v1.7 WARN-02 增强: 涵盖更多单位变体 + 前后修饰
              //   - 货币符号: ¥ $ € £ ₹ ₩ ₽
              //   - 量级词: 亿 万 百万 千万 万亿 十亿 兆(可前后拼接数字 / 货币符号)
              //   - 英文缩写: k M B T(thousand/million/billion/trillion)
              //   - 百分比与年增: % CAGR YoY
              const UNIT_PATTERN =
                /(?:¥|\$|€|£|￥|₩|₹|₽|亿美元|亿人民币|亿美金|百万|千万|万亿|十亿|百亿|千亿|亿|万|k\b|M\b|B\b|T\b|billion|million|trillion|CAGR|YoY|%|％)/i;
              const YEAR_PATTERN = /(?:20\d{2}|19\d{2})/;
              const hasUnit = UNIT_PATTERN.test(text);
              const hasYear = YEAR_PATTERN.test(text);
              // v1.8 P4-A: 枚举检测到的 token,把抽象"是否含单位"具象化为具体锚点
              const CURRENCY_PATTERN =
                /(?:人民币|美元|美金|日元|欧元|英镑|港币|RMB|USD|JPY|EUR|GBP|HKD|CNY)/gi;
              const SCALE_PATTERN =
                /(?:万亿|十亿|百亿|千亿|百万|千万|亿|万|billion|million|trillion|[kKmMbB]\b)/g;
              const GROWTH_PATTERN = /(?:CAGR|YoY|年增|年化|同比增长|复合增长)/gi;
              const currencies = Array.from(new Set(text.match(CURRENCY_PATTERN) ?? []));
              const scales = Array.from(new Set((text.match(SCALE_PATTERN) ?? []).map((s) => s.toLowerCase())));
              const years = Array.from(new Set(text.match(/\b(?:20\d{2}|19\d{2})\b/g) ?? []));
              const growths = Array.from(new Set(text.match(GROWTH_PATTERN) ?? []));
              const detectedCount = currencies.length + scales.length + years.length + growths.length;
              return (
                <section id="section-market-size" className="mt-10 pt-8 border-t border-border/30">
                  <Card
                    title="市场规模估算"
                    action={
                      <SectionAnnotation
                        projectId={id ?? ''}
                        sectionKey="section-market-size"
                        sectionLabel="市场规模估算"
                      />
                    }
                  >
                    <p className="text-body leading-relaxed">{text}</p>
                    {/* v1.8 P4-A: 推断详情 — 把"是否含单位"具象化为实际锚点, 让读者一眼看到"已含 USD/2026/亿" */}
                    {text.trim() && detectedCount > 0 && (
                      <div className="mt-3 text-helper text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span aria-hidden className="opacity-70">📊</span>
                        <span>检测到</span>
                        {currencies.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-text-primary">
                            <span className="text-text-tertiary">币种</span>
                            {currencies.map((c, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-primary/15 text-primary-light border border-primary/30 text-helper">
                                {c}
                              </span>
                            ))}
                          </span>
                        )}
                        {scales.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-text-primary">
                            <span className="text-text-tertiary">量级</span>
                            {scales.map((s, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 text-helper">
                                {s}
                              </span>
                            ))}
                          </span>
                        )}
                        {years.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-text-primary">
                            <span className="text-text-tertiary">年份</span>
                            {years.map((y, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-helper">
                                {y}
                              </span>
                            ))}
                          </span>
                        )}
                        {growths.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-text-primary">
                            <span className="text-text-tertiary">增长</span>
                            {growths.map((g, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-helper">
                                {g}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    )}
                    {/* 数据范围提示卡: 让读者一眼看到"这是哪一年 / 什么币种 / 什么口径" */}
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <RangeChip
                        label="单位"
                        ok={hasUnit}
                        okText="已含单位"
                        hintText="数字缺少单位(亿/万/¥/$ 等)"
                      />
                      <RangeChip
                        label="基线年份"
                        ok={hasYear}
                        okText="已含年份"
                        hintText="未声明数据是哪一年"
                      />
                      <RangeChip
                        label="估算口径"
                        ok={false}
                        okText="参考值 · 建议交叉验证"
                        hintText="估算数据"
                        always
                      />
                    </div>
                  </Card>
                </section>
              );
            })()}

            {/* 8. 风险与机会 */}
            <section id="section-risk-opp" className="mt-10 pt-8 border-t border-border/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card
                  title="风险"
                  action={
                    <SectionAnnotation
                      projectId={id ?? ''}
                      sectionKey="section-risk"
                      sectionLabel="风险"
                    />
                  }
                >
                  {currentReport.risks.length === 0 ? (
                    <div className="text-helper text-text-secondary">暂无数据</div>
                  ) : (
                    <ul className="space-y-2">
                      {currentReport.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-red-400 mt-1 flex-shrink-0">⚠</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card
                  title="机会"
                  action={
                    <SectionAnnotation
                      projectId={id ?? ''}
                      sectionKey="section-opportunity"
                      sectionLabel="机会"
                    />
                  }
                >
                  {currentReport.opportunities.length === 0 ? (
                    <div className="text-helper text-text-secondary">暂无数据</div>
                  ) : (
                    <ul className="space-y-2">
                      {currentReport.opportunities.map((o, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-emerald-400 mt-1 flex-shrink-0">★</span>
                          <span>{o}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </section>

            {/* 9. 数据来源 - v1.6: 贡献度可视化卡片网格 */}
            <section
              id="section-sources"
              className="mt-12 pt-8 border-t border-border/40"
            >
              <Card
                title={
                  <span className="inline-flex items-center gap-2">
                    数据来源
                    {currentReport.contributions && currentReport.contributions.length > 0 && (
                      <span className="text-helper font-normal text-text-secondary">
                        （{currentReport.contributions.length} 个来源 / 合计{' '}
                        {currentReport.contributions.reduce((acc, c) => acc + c.count, 0)} 条）
                      </span>
                    )}
                  </span>
                }
                action={
                  <SectionAnnotation
                    projectId={id ?? ''}
                    sectionKey="section-sources"
                    sectionLabel="数据来源"
                  />
                }
              >
                {/* 贡献度分布条(v1.6) */}
                {currentReport.contributions && currentReport.contributions.length > 0 ? (
                  <div className="mb-6">
                    <div className="flex w-full h-3 rounded-full overflow-hidden bg-slate-700/40 border border-border">
                      {currentReport.contributions.map((c, i) => (
                        <div
                          key={c.source}
                          className="h-full transition-all"
                          style={{
                            width: `${c.percentage}%`,
                            // 按 type 取色,type 差异营造视觉区分
                            backgroundColor:
                              c.type === 'forum'
                                ? '#F59E0B'
                                : c.type === 'search'
                                  ? '#38BDF8'
                                  : c.type === 'social'
                                    ? '#A855F7'
                                    : '#10B981',
                          }}
                          title={`${c.source}: ${c.percentage}%`}
                          aria-label={`${c.source} 贡献 ${c.percentage}%`}
                        />
                      ))}
                    </div>
                    {/* 占比图例:与卡片网格互为补充 */}
                    <div className="mt-2 flex flex-wrap gap-3 text-helper text-text-secondary">
                      {currentReport.contributions.map((c) => (
                        <span key={c.source} className="inline-flex items-center gap-1">
                          <span
                            className="inline-block w-3 h-3 rounded-sm"
                            style={{
                              backgroundColor:
                                c.type === 'forum'
                                  ? '#F59E0B'
                                  : c.type === 'search'
                                    ? '#38BDF8'
                                    : c.type === 'social'
                                      ? '#A855F7'
                                      : '#10B981',
                            }}
                            aria-hidden
                          />
                          <span>{c.source}</span>
                          <span className="text-text-tertiary">{c.percentage}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* 贡献度卡片网格(v1.6) */}
                {currentReport.contributions && currentReport.contributions.length > 0 && (
                  <div className="mb-6">
                    <div className="text-helper text-text-secondary mb-3">
                      各来源贡献度（按加权占比降序）
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {currentReport.contributions.map((c) => {
                        const max = currentReport.contributions![0]?.percentage ?? 0;
                        return (
                          <SourceContributionCard
                            key={c.source}
                            contribution={c}
                            maxPercentage={max}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 原始来源链接列表(保留,老报告/无 contributions 时仍可用) */}
                {currentReport.sources.length === 0 ? (
                  <div className="text-helper text-text-secondary">暂无来源</div>
                ) : (
                  <div className={currentReport.contributions && currentReport.contributions.length > 0 ? 'pt-4 border-t border-border' : ''}>
                    {currentReport.contributions && currentReport.contributions.length > 0 && (
                      <div className="text-helper text-text-secondary mb-2">原始引用</div>
                    )}
                    <ul className="space-y-2">
                      {currentReport.sources.map((s, i) => (
                        <li key={i} className="text-body">
                          {s.url ? (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline break-all"
                            >
                              [{i + 1}] {s.title}
                            </a>
                          ) : (
                            <span className="text-text-primary break-all">
                              [{i + 1}] {s.title}
                            </span>
                          )}
                          {s.source && (
                            <span className="ml-2 text-helper text-text-secondary">
                              ({s.source})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </section>

            {/* 导出进度条 - 仅在 exportProgress/exportResult 存在时渲染 */}
            {(exportProgress !== null || exportResult !== null) && (
              <div className="mt-6 no-print" role="status" aria-live="polite">
                {exportProgress !== null && (
                  <div className="bg-card/90 backdrop-blur-xl border border-primary/40 rounded-card shadow-glass px-4 py-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-lg">
                        {exportProgress.format === 'pdf' ? '📄' : exportProgress.format === 'md' ? '📝' : '🗂'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-body text-text-primary font-medium">
                            正在导出 {exportProgress.format === 'pdf' ? 'PDF' : exportProgress.format === 'md' ? 'Markdown' : 'JSON'} · {exportProgress.phase === 'connecting' ? '连接后端' : exportProgress.phase === 'generating' ? '后端生成中' : '下载到本地'}
                          </div>
                          <div className="text-helper text-text-tertiary tabular-nums shrink-0">
                            已用 {exportElapsed}s
                          </div>
                        </div>
                        {/* indeterminate 进度条:利用 CSS animation 在 0~70% 之间滑动 */}
                        <div className="mt-2 h-1 bg-border/40 rounded-full overflow-hidden">
                          <div
                            className="h-full w-1/3 bg-gradient-to-r from-primary to-primary-light rounded-full"
                            style={{
                              animation: 'indeterminate 1.4s ease-in-out infinite',
                            }}
                          />
                        </div>
                        {exportProgress.phase === 'generating' && exportElapsed >= 8 && (
                          <div className="mt-2 text-helper text-amber-400">
                            ⏳ 大报告生成时间可能稍长，请勿关闭页面…
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {exportResult !== null && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-card px-4 py-3 mb-3 flex items-center gap-2 transition-opacity">
                    <span className="text-emerald-400">✅</span>
                    <span className="text-body text-text-primary">
                      {exportResult.format === 'pdf' ? 'PDF' : exportResult.format === 'md' ? 'Markdown' : 'JSON'} 已下载到本地
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* v1.7.1 FR-14: 落地页生成配置 - CTA / 表单字段可定制(默认折叠) */}
            <details className="mt-4 bg-card/40 backdrop-blur border border-border rounded-card no-print">
              <summary className="cursor-pointer select-none px-4 py-2 text-helper text-text-secondary hover:text-text-primary list-none flex items-center gap-2">
                <span aria-hidden>⚙️</span>
                <span className="font-medium">落地页生成配置</span>
                <span className="ml-auto text-text-tertiary">展开/收起</span>
              </summary>
              <div className="px-4 pb-4 pt-2 space-y-3 border-t border-border">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block text-helper text-text-secondary">
                    <span className="block mb-1">按钮文案(留空 → 智能推荐)</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={landingConfig.call_to_action}
                      onChange={(e) =>
                        setLandingConfig((c) => ({ ...c, call_to_action: e.target.value }))
                      }
                      placeholder="如:立即订阅 / 免费试用"
                      className="w-full h-9 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                    />
                  </label>
                  <label className="block text-helper text-text-secondary">
                    <span className="block mb-1">按钮下方提示</span>
                    <input
                      type="text"
                      maxLength={120}
                      value={landingConfig.call_to_action_subtext}
                      onChange={(e) =>
                        setLandingConfig((c) => ({ ...c, call_to_action_subtext: e.target.value }))
                      }
                      placeholder="如:无需信用卡 · 30 天试用"
                      className="w-full h-9 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                    />
                  </label>
                  <label className="block text-helper text-text-secondary">
                    <span className="block mb-1">提交成功提示</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={landingConfig.success_message}
                      onChange={(e) =>
                        setLandingConfig((c) => ({ ...c, success_message: e.target.value }))
                      }
                      placeholder="默认:提交成功,感谢!"
                      className="w-full h-9 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                    />
                  </label>
                  <label className="block text-helper text-text-secondary">
                    <span className="block mb-1">主题</span>
                    <select
                      value={landingConfig.theme}
                      onChange={(e) =>
                        setLandingConfig((c) => ({
                          ...c,
                          theme: e.target.value as 'light' | 'dark',
                        }))
                      }
                      className="w-full h-9 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                    >
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </label>
                </div>

                {/* 表单字段列表 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-helper text-text-secondary">表单字段(最多 5 个)</span>
                    {landingConfig.fields.length < 5 && (
                      <button
                        type="button"
                        onClick={() =>
                          setLandingConfig((c) => ({
                            ...c,
                            fields: [
                              ...c.fields,
                              {
                                name: `field_${c.fields.length + 1}`,
                                type: 'text',
                                label: '新字段',
                                placeholder: '',
                                required: false,
                              },
                            ],
                          }))
                        }
                        className="text-helper text-primary hover:text-primary-light"
                      >
                        + 添加字段
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {landingConfig.fields.map((f, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-12 gap-2 items-center bg-card-solid/30 border border-border rounded-lg px-3 py-2"
                      >
                        <input
                          type="text"
                          value={f.name}
                          onChange={(e) =>
                            setLandingConfig((c) => ({
                              ...c,
                              fields: c.fields.map((x, j) =>
                                j === i ? { ...x, name: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="name"
                          className="col-span-2 h-8 px-2 border border-border rounded bg-card-solid/50 text-helper text-text-primary"
                        />
                        <select
                          value={f.type}
                          onChange={(e) =>
                            setLandingConfig((c) => ({
                              ...c,
                              fields: c.fields.map((x, j) =>
                                j === i
                                  ? { ...x, type: e.target.value as 'email' | 'phone' | 'text' }
                                  : x
                              ),
                            }))
                          }
                          className="col-span-2 h-8 px-2 border border-border rounded bg-card-solid/50 text-helper text-text-primary"
                        >
                          <option value="email">邮箱</option>
                          <option value="phone">电话</option>
                          <option value="text">文本</option>
                        </select>
                        <input
                          type="text"
                          value={f.label}
                          onChange={(e) =>
                            setLandingConfig((c) => ({
                              ...c,
                              fields: c.fields.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="标签"
                          className="col-span-2 h-8 px-2 border border-border rounded bg-card-solid/50 text-helper text-text-primary"
                        />
                        <input
                          type="text"
                          value={f.placeholder}
                          onChange={(e) =>
                            setLandingConfig((c) => ({
                              ...c,
                              fields: c.fields.map((x, j) =>
                                j === i ? { ...x, placeholder: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="placeholder"
                          className="col-span-4 h-8 px-2 border border-border rounded bg-card-solid/50 text-helper text-text-primary"
                        />
                        <label className="col-span-1 inline-flex items-center gap-1 text-helper text-text-secondary">
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={(e) =>
                              setLandingConfig((c) => ({
                                ...c,
                                fields: c.fields.map((x, j) =>
                                  j === i ? { ...x, required: e.target.checked } : x
                                ),
                              }))
                            }
                          />
                          <span>必填</span>
                        </label>
                        {landingConfig.fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setLandingConfig((c) => ({
                                ...c,
                                fields: c.fields.filter((_, j) => j !== i),
                              }))
                            }
                            className="col-span-1 h-8 text-text-tertiary hover:text-red-400"
                            title="删除字段"
                            aria-label="删除字段"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-helper text-text-tertiary">
                  提示: 留空所有字段,后端会根据项目名称与价值主张智能推萘 CTA。
                </p>
              </div>
            </details>

            {/* 操作按钮区 - 3 类分组:分享/导出 / 流程 / 产物 */}
            <div className="mt-8 no-print">
              <div className="bg-card backdrop-blur-xl border border-border rounded-card shadow-glass px-4 py-3">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {/* 组 1: 分享 + 导出 (次要) */}
                  <Dropdown
                    trigger={
                      <Button variant="outline" disabled={exportBusy !== null}>
                        分享 ▾
                      </Button>
                    }
                    items={[
                      {
                        label: copySuccess ? '✓ 已复制!' : '📋 复制摘要',
                        onClick: () => void copySummary(),
                      },
                      {
                        label: '🔗 复制链接',
                        onClick: shareLink,
                      },
                      {
                        // v1.8 P4-B: 桌面应用深链 - 安装桌面版后点击会拉起应用跳转到本报告页
                        label: copySuccess ? '✓ 已复制!' : '🚀 复制桌面深链',
                        onClick: () => void copyDeepLink(),
                      },
                      {
                        label: '🖨️ 打印报告',
                        // v1.8 P1-D: 打印按钮套用当前纸张偏好
                        onClick: () => {
                          applyPaperSize(loadPdfPreferences());
                          window.print();
                        },
                      },
                    ]}
                  />

                  <Dropdown
                    trigger={
                      <Button
                        variant="outline"
                        disabled={exportBusy !== null && exportBusy === 'json'}
                        loading={exportBusy !== null && exportBusy === 'json'}
                        data-testid="export-toggle"
                      >
                        导出 ▾
                      </Button>
                    }
                    items={[
                      {
                        label: exportBusy === 'md' ? '⏳ 导出中...' : '📝 Markdown',
                        onClick: () => handleExport('md'),
                        loading: exportBusy === 'md',
                        testId: 'export-md',
                      },
                      {
                        label: exportBusy === 'pdf' ? '⏳ 导出中...' : '🖨 PDF',
                        onClick: () => handleExport('pdf'),
                        loading: exportBusy === 'pdf',
                        testId: 'export-pdf',
                      },
                      {
                        label: exportBusy === 'json' ? '⏳ 导出中...' : '🗂 JSON',
                        onClick: handleExportJson,
                        loading: exportBusy === 'json',
                      },
                    ]}
                  />

                  {/* v1.8 P1-D: 纸张选择 - 与"导出"并列,便于在导出 PDF/打印前切换纸张大小/方向 */}
                  <PaperSizePicker disabled={exportBusy !== null} />

                  <span className="hidden md:inline-block w-px h-6 bg-border mx-1" aria-hidden />

                  {/* 组 2: 流程动作 (中等) */}
                  <Button
                    variant="outline"
                    loading={landingLoading}
                    disabled={exportBusy !== null || landingLoading}
                    onClick={handleGenerateLanding}
                  >
                    生成验证页
                  </Button>

                  <Button
                    variant="outline"
                    loading={discussing}
                    disabled={exportBusy !== null || discussing}
                    onClick={() => void handleFurtherDiscuss()}
                    data-testid="further-discuss"
                  >
                    进一步探讨
                  </Button>

                  <Button
                    variant="outline"
                    loading={duplicating}
                    disabled={exportBusy !== null || duplicating}
                    onClick={() => void handleDuplicate()}
                    data-testid="duplicate-project"
                    title="复制为新项目并重新调研,保留原始报告"
                  >
                    📋 复制并重新调研
                  </Button>

                  <span className="hidden md:inline-block w-px h-6 bg-border mx-1" aria-hidden />

                  {/* 组 3: 高级产物 (主) */}
                  <Button
                    variant="primary"
                    loading={docsJob?.status === 'running' || docsDownloading}
                    disabled={
                      exportBusy !== null ||
                      docsJob?.status === 'running' ||
                      docsDownloading
                    }
                    onClick={() => handleGenerateDocs()}
                    data-testid="generate-docs"
                  >
                    {docsDownloading
                      ? '下载中...'
                      : docsJob?.status === 'running'
                        ? '生成中...'
                        : docsJob?.status === 'success'
                          ? `下载${docsJob.version === 'mvp' ? 'MVP' : ''}开发文档`
                          : docsJob?.status === 'failed'
                            ? '重新生成开发文档'
                            : '生成开发文档'}
                  </Button>

                  <Button
                    variant="primary"
                    loading={bpJob?.status === 'running' || bpSaving}
                    disabled={
                      exportBusy !== null ||
                      bpJob?.status === 'running' ||
                      bpSaving
                    }
                    onClick={() => handleGenerateBp()}
                  >
                    {bpSaving
                      ? '另存中...'
                      : bpJob?.status === 'running'
                        ? '生成中...'
                        : bpJob?.status === 'success'
                          ? '另存商业计划书'
                          : bpJob?.status === 'failed'
                            ? '重新生成商业计划书'
                            : '生成商业计划书'}
                  </Button>
                </div>
              </div>
            </div>

            {/* 移动端底部操作栏 */}
            <div className="lg:hidden mt-4 flex justify-center no-print">
              <Button variant="text" onClick={() => setShowReResearch(true)}>
                🔄 重新调研
              </Button>
            </div>
          </>
        )}

        {/* 三状态区分(代替原“该调研尚未开始或未生成报告”模糊文案)
             - pending: 项目未启动调研,可点击「开始调研」启动
             - analyzing-completed-empty: status===completed但 report 为空,可能是中断
             - failed: status===failed,提供「重试调研」按钮(via friendly action)
        */}
        {(() => {
          const ps = project?.status;
          const hasReport = currentReport !== null;
          // isAnalyzing 已经覆盖了「正在加载」状态,这里只处理「无报告」的情况
          if (isAnalyzing || hasReport || loadError) return null;

          // 优先识别业务状态
          if (ps === 'completed' || (project && project.report === null && hasReport === false)) {
            // 调研状态为 completed,却没有 report(可能异常)
            return (
              <Card>
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>📋</span>
                  <div className="flex-1">
                    <h3 className="text-body font-medium text-text-primary mb-1">
                      报告生成不完整
                    </h3>
                    <p className="text-helper text-text-secondary mb-4">
                      项目状态显示为「已完成」，但未能获取到报告内容。
                      这通常是后端进程意外退出导致。点击下方按钮手动重新调研。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={handleReResearch}>
                        🔄 重新调研
                      </Button>
                      <Button variant="outline" onClick={() => setShowVersionSelect(true)}>
                        ⚙生成开发文档
                      </Button>
                      <Button variant="text" onClick={() => navigate('/')}>
                        ← 返回首页
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          }

          if (ps === 'failed') {
            return (
              <Card>
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>❌</span>
                  <div className="flex-1">
                    <h3 className="text-body font-medium text-text-primary mb-1">
                      上次调研未成功
                    </h3>
                    <p className="text-helper text-text-secondary mb-4">
                      原因可能是数据源不稳定或 LLM 调用失败。可点击重试,也可查看历史记录中的错误详情。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={handleReResearch}>
                        🔄 重试调研
                      </Button>
                      <Button variant="text" onClick={() => navigate('/history')}>
                        → 历史记录
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          }

          if (ps === 'draft' || ps === undefined) {
            // 未开始调研
            return (
              <Card>
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>✨</span>
                  <div className="flex-1">
                    <h3 className="text-body font-medium text-text-primary mb-1">
                      调研尚未启动
                    </h3>
                    <p className="text-helper text-text-secondary mb-4">
                      点击「开始调研」后,系统将多源采集创意可行性数据,约需 30~90 秒。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" loading={loading} onClick={() => id && trigger(id)}>
                        🚀 开始调研
                      </Button>
                      <Button variant="text" onClick={() => navigate('/')}>
                        ← 返回首页
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          }

          if (ps === 'analyzing') {
            // 状态表示分析中,但 hook 层未处于 loading:重新触发以恢复 polling
            return (
              <Card>
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>⚙</span>
                  <div className="flex-1">
                    <h3 className="text-body font-medium text-text-primary mb-1">
                      调研状态未同步
                    </h3>
                    <p className="text-helper text-text-secondary mb-4">
                      项目处于“分析中”状态，点击下方按钮重新启动轮询。
                    </p>
                    <Button variant="primary" loading={loading} onClick={() => id && trigger(id)}>
                      重新连接调研进度
                    </Button>
                  </div>
                </div>
              </Card>
            );
          }

          // 兑底: 原文本
          return (
            <Card>
              <div className="text-text-secondary">该调研尚未开始或未生成报告</div>
              <div className="mt-4 flex gap-2">
                <Link to="/" className="text-primary hover:underline text-[15px]">
                  ← 返回首页
                </Link>
              </div>
            </Card>
          );
        })()}

        <LlmSetupPrompt
          open={!loading && errorCode === 'MISSING_API_KEY'}
          errorCode={errorCode}
          onClose={() => {
            reset();
          }}
          onGoSettings={() => navigate('/settings')}
        />
      </Container>

      {/* 重新调研确认弹窗 */}
      {showReResearch && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 no-print">
          <div className="bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card p-6 max-w-sm w-full mx-4 shadow-glass">
            <h3 className="text-lg font-medium text-text-primary mb-2">重新调研</h3>
            <p className="text-text-secondary text-sm mb-4">
              确定要重新生成调研报告吗?当前报告将被覆盖。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowReResearch(false)}>
                取消
              </Button>
              <Button variant="primary" onClick={handleReResearch}>
                确认重新调研
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 落地页预览弹窗 */}
      {landingPreview && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 no-print p-4">
          <div className="bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card w-full max-w-4xl max-h-[90vh] flex flex-col shadow-glass">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-medium text-text-primary">验证落地页预览</h3>
                {landingPlugin && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-primary/30 bg-primary/10 text-primary-light"
                    title={`插件 ${landingPlugin.name} v${landingPlugin.version} · 来源 ${landingPlugin.source} · 优先级 ${landingPlugin.priority}`}
                  >
                    <span aria-hidden>🧩</span>
                    <span>{landingPlugin.name} v{landingPlugin.version}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={downloadLanding}>
                  下载 HTML
                </Button>
                <Button variant="text" onClick={() => setLandingPreview(null)}>
                  关闭
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <iframe
                srcDoc={landingPreview}
                title="落地页预览"
                className="w-full h-[60vh] border-0"
                sandbox=""
              />
            </div>
          </div>
        </div>
      )}

      {/* 技术选型弹窗 */}
      <TechSelectionModal
        open={showTechSelection}
        projectId={id ?? ''}
        onClose={() => setShowTechSelection(false)}
        onConfirm={(plan) => {
          setSelectedTechPlan(plan);
        }}
      />

      {/* 前端设计方案弹窗 */}
      <FrontendDesignModal
        open={showFrontendDesign}
        projectId={id ?? ''}
        onClose={() => setShowFrontendDesign(false)}
        onConfirm={(plan) => {
          setSelectedDesignPlan(plan);
        }}
      />

      {/* 版本选择 + 选型引导弹窗(层级低于子弹窗 TechSelectionModal/FrontendDesignModal,确保选中弹窗始终在最前) */}
      {showVersionSelect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 no-print p-4">
          <div className="bg-card-solid/95 backdrop-blur-2xl border border-border rounded-card w-full max-w-2xl max-h-[85vh] flex flex-col shadow-glass">
            <div className="p-6 border-b border-border">
              <h2 className="text-section text-text-primary">生成开发文档</h2>
              <p className="text-helper text-text-secondary mt-1">
                选择文档版本和配置,AI 将为你生成精准的开发文档
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 步骤 1: 技术选型 */}
              <div className="border border-border rounded-card p-4 bg-card-solid/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-gradient-to-r from-primary to-accent text-white text-[13px] flex items-center justify-center font-medium">
                      1
                    </span>
                    <span className="text-[16px] font-medium text-text-primary">技术选型</span>
                    {selectedTechPlan && (
                      <span className="text-[12px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        已选择: {selectedTechPlan.plan_name}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowTechSelection(true)}
                    className="text-[14px] text-primary hover:underline"
                  >
                    {selectedTechPlan ? '重新选择' : '开始选型'}
                  </button>
                </div>
                <p className="text-[13px] text-text-secondary ml-8">
                  AI 基于项目需求推荐 3 套技术栈方案,选择后开发文档将严格按选定技术栈生成
                </p>
              </div>

              {/* 步骤 2: 前端设计方案 */}
              <div className="border border-border rounded-card p-4 bg-card-solid/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-gradient-to-r from-primary to-accent text-white text-[13px] flex items-center justify-center font-medium">
                      2
                    </span>
                    <span className="text-[16px] font-medium text-text-primary">前端设计方案</span>
                    {selectedDesignPlan && (
                      <span className="text-[12px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        已选择: {selectedDesignPlan.plan_name}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowFrontendDesign(true)}
                    className="text-[14px] text-primary hover:underline"
                  >
                    {selectedDesignPlan ? '重新选择' : '选择设计'}
                  </button>
                </div>
                <p className="text-[13px] text-text-secondary ml-8">
                  AI 基于用户画像推荐多套前端设计方案,选择后 PRD 和前端相关文档将体现设计风格
                </p>
              </div>

              {/* 步骤 3: 版本选择 */}
              <div className="border border-border rounded-card p-4 bg-card-solid/30">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-gradient-to-r from-primary to-accent text-white text-[13px] flex items-center justify-center font-medium">
                    3
                  </span>
                  <span className="text-[16px] font-medium text-text-primary">选择版本</span>
                </div>
                <div className="grid grid-cols-2 gap-3 ml-8">
                  <div
                    onClick={() => setDocVersion('mvp')}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      docVersion === 'mvp'
                        ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                        : 'border-border hover:border-primary/50 bg-card-solid/20'
                    }`}
                  >
                    <div className="text-[15px] font-medium text-text-primary mb-1">MVP 版</div>
                    <div className="text-[12px] text-text-secondary mb-2">
                      8 份文档 · 聚焦最小可行产品
                    </div>
                    <ul className="text-[12px] text-text-secondary space-y-0.5">
                      <li>✓ 结合商业模式定义 MVP 边界</li>
                      <li>✓ 明确验证目标和成功指标</li>
                      <li>✓ 最简技术方案,快速上线</li>
                    </ul>
                  </div>
                  <div
                    onClick={() => setDocVersion('full')}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      docVersion === 'full'
                        ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                        : 'border-border hover:border-primary/50 bg-card-solid/20'
                    }`}
                  >
                    <div className="text-[15px] font-medium text-text-primary mb-1">完整版</div>
                    <div className="text-[12px] text-text-secondary mb-2">
                      10 份文档 · 完整项目说明书
                    </div>
                    <ul className="text-[12px] text-text-secondary space-y-0.5">
                      <li>✓ 完整 PRD + 技术蓝图</li>
                      <li>✓ 详细的功能模块和数据库设计</li>
                      <li>✓ 完整的测试和部署运维方案</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* MVP 商业模式输入(仅 MVP 版显示) */}
              {docVersion === 'mvp' && (
                <div className="border border-border rounded-card p-4 bg-card-solid/30">
                  <div className="text-[15px] font-medium text-text-primary mb-2">
                    商业模式描述(可选)
                  </div>
                  <p className="text-[12px] text-text-secondary mb-2">
                    简要描述你的商业模式(收入模式、定价策略、目标客户等),AI 将结合商业模式定义 MVP 的边界和验证目标
                  </p>
                  <textarea
                    value={businessModel}
                    onChange={(e) => setBusinessModel(e.target.value)}
                    placeholder="例如:SaaS 订阅模式,面向中小企业,按月收费,客单价 99 元/月..."
                    className="w-full h-20 p-3 border border-border rounded-lg text-[14px] text-text-primary placeholder:text-text-tertiary bg-card-solid/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60 resize-none"
                  />
                </div>
              )}
            </div>

            <div className="p-6 border-t border-border flex justify-between items-center">
              <button
                onClick={() => setShowVersionSelect(false)}
                className="h-10 px-4 text-[15px] text-text-secondary hover:text-text-primary transition-colors"
              >
                取消
              </button>
              <button
                onClick={triggerDocsGeneration}
                disabled={false}
                className="h-10 px-6 text-[15px] font-medium rounded-lg bg-gradient-to-r from-primary to-primary-dark text-white hover:from-primary-light hover:to-primary transition-all shadow-glow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                开始生成{docVersion === 'mvp' ? 'MVP' : '完整'}文档
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  /**
   * 处理导出:后端先尝试生成;PDF 后端 503 (未找到 Chromium) 时降级到 window.print()
   * 函数声明会在组件内部 hoisting,JSX 中的 onClick 可直接引用
   */
  async function handleExport(format: 'md' | 'pdf'): Promise<void> {
    if (!id) return;
    // v1.8 P1-D: PDF/打印前确保 @page 注入当前偏好(后端 Chromium 与浏览器打印都尊重 @page)
    if (format === 'pdf') {
      applyPaperSize(loadPdfPreferences());
    }
    setExportBusy(format);
    setExportProgress({ format, startedAt: Date.now(), phase: 'connecting' });
    try {
      if (format === 'md') {
        // md 直接触发后端下载 URL,避免 blob 在 Electron 保存对话框期间失效
        setExportProgress({ format, startedAt: Date.now(), phase: 'downloading' });
        downloadUrl(api.reportDownloadUrl(id, 'md'));
        // md 几乎即时下载完成,优化提示时机
        window.setTimeout(() => {
          setExportProgress(null);
          setExportResult({ format, ts: Date.now() });
        }, 300);
      } else {
        // PDF 需捕获后端 503(未找到 Chromium)以降级到浏览器打印,故保留 fetch blob
        // 阶段 1:connecting 阶段 2:generating(后端生成 PDF)阶段 3:downloading
        const { blob, filename } = await api.downloadReport(id, 'pdf');
        setExportProgress({ format, startedAt: Date.now(), phase: 'downloading' });
        downloadBlob(blob, filename);
        setExportProgress(null);
        setExportResult({ format, ts: Date.now() });
      }
    } catch (err) {
      const e = err as Error & { status?: number };
      const isChromeMissing =
        format === 'pdf' &&
        (e.status === 503 || (e.message ?? '').includes('CHROMIUM'));

      if (isChromeMissing) {
        // 检测客户端 OS,以给出对应的“另存为 PDF”步骤指引
        const os = detectClientOS();
        const steps = pdfPrintSteps(os);
        const useBrowserPrint = await dialog.confirm({
          title: 'PDF 导出降级',
          message: (
            <div className="space-y-3">
              <p>
                后端未配置 PDF 生成器（本机未检测到 Chrome / Edge / Chromium）。
                是否改用浏览器内置打印？只需在打开的打印对话框中选择
                <span className="font-medium text-text-primary">「另存为 PDF」</span>
                即可生成 PDF。
              </p>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-helper text-amber-200">
                <div className="font-medium mb-1">📌 当前系统:{osLabel(os)}</div>
                <ol className="list-decimal pl-5 space-y-0.5">
                  {steps.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ol>
              </div>
              <p className="text-helper text-text-tertiary">
                小技巧: “另存为 PDF”一般在打印对话框的左上角“目标打印机”或右下角菜单中。
              </p>
            </div>
          ),
          primaryLabel: '开始打印',
          secondaryLabel: '取消',
          tone: 'warning',
        });
        if (useBrowserPrint) {
          // v1.8 P1-D: 打印降级路径也要套用用户纸张偏好
          applyPaperSize(loadPdfPreferences());
          window.print();
        }
      } else {
        await dialog.alert({
          title: `导出 ${format.toUpperCase()} 失败`,
          message: e.message ?? String(err),
          tone: 'danger',
        });
      }
    } finally {
      setExportBusy(null);
    }
  }

  /**
   * 生成/下载开发文档 - 引导式流程
   *   1. 已生成成功 → 直接下载
   *   2. 生成中 → 忽略
   *   3. 未生成 → 打开版本选择弹窗,引导用户完成选型后生成
   */
  async function handleGenerateDocs(): Promise<void> {
    if (!id) return;

    // 成功 → 下载
    if (docsJob?.status === 'success') {
      setDocsDownloading(true);
      try {
        downloadUrl(api.docsDownloadUrl(id));
      } catch (err) {
        await dialog.alert({
          title: '下载失败',
          message: err instanceof Error ? err.message : String(err),
          tone: 'danger',
        });
      } finally {
        setDocsDownloading(false);
      }
      return;
    }

    // 进行中 → 忽略点击 (按钮已 disabled 防止双重触发)
    if (docsJob?.status === 'running') return;

    // 未触发或失败 → 打开版本选择弹窗,开始引导式流程
    setShowVersionSelect(true);
  }

  /**
   * 实际触发文档生成(在用户完成选型和版本选择后调用)
   */
  async function triggerDocsGeneration(): Promise<void> {
    if (!id) return;
    setDocsError(null);
    setShowVersionSelect(false);
    try {
      const job = await api.triggerDocs(id, {
        version: docVersion,
        use_tech_selection: !!selectedTechPlan,
        use_frontend_design: !!selectedDesignPlan,
        business_model: businessModel || undefined,
      });
      setDocsJob(job);
      if (job.status === 'running') {
        const poll = async (): Promise<void> => {
          try {
            const next = await api.getDocsStatus(id);
            setDocsJob(next);
            if (next.status === 'running') return;
            if (docsTimerRef.current !== null) {
              window.clearInterval(docsTimerRef.current);
              docsTimerRef.current = null;
            }
            if (next.status === 'failed') {
              setDocsError(next.error_message ?? '生成失败');
            }
          } catch {
            if (docsTimerRef.current !== null) {
              window.clearInterval(docsTimerRef.current);
              docsTimerRef.current = null;
            }
          }
        };
        await poll();
        if (docsTimerRef.current === null) {
          docsTimerRef.current = window.setInterval(poll, DOCS_POLL_INTERVAL);
        }
      }
    } catch (err) {
      await dialog.alert({
        title: '触发失败',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    }
  }

  /**
   * 生成/另存商业计划书
   *   - 未生成或已失败: 触发生成,启动轮询(success 时由 useEffect 自动调预览)
   *   - 生成成功: 弹原生目录选择对话框,把 12 份 md 复制到用户选定位置
   * 函数声明会被 hoisting,JSX 中可直接引用
   */
  async function handleGenerateBp(): Promise<void> {
    if (!id) return;

    // 成功 → 另存(桌面端专属交互)
    if (bpJob?.status === 'success') {
      if (!bpJob.archive_path) {
        await dialog.alert({
          title: '另存失败',
          message: '商业计划书归档路径丢失,请重新生成',
          tone: 'danger',
        });
        return;
      }
      if (!desktop.isDesktop || !desktop.saveDir) {
        await dialog.alert({
          title: '桌面端专属功能',
          message: '“另存商业计划书”仅在桌面端可用。',
          tone: 'warning',
        });
        return;
      }
      setBpSaving(true);
      try {
        const safeName = (project?.name ?? '项目').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
        const res = await desktop.saveDir({
          sourceDir: bpJob.archive_path,
          defaultName: `${safeName}-商业计划书`,
        });
        if (res.canceled) return; // 用户主动取消,静默
        if (res.ok && res.targetDir) {
          await dialog.alert({
            title: '另存成功',
            message: `已另存到：\n${res.targetDir}`,
            tone: 'primary',
          });
        } else {
          await dialog.alert({
            title: '另存失败',
            message: res.message ?? '未知错误',
            tone: 'danger',
          });
        }
      } catch (err) {
        await dialog.alert({
          title: '另存失败',
          message: err instanceof Error ? err.message : String(err),
          tone: 'danger',
        });
      } finally {
        setBpSaving(false);
      }
      return;
    }

    // 进行中 → 忽略点击 (按钮已 disabled 防止双重触发)
    if (bpJob?.status === 'running') return;

    // 未触发或失败 → 重新触发
    setBpError(null);
    try {
      const job = await api.triggerBp(id);
      setBpJob(job);
      if (job.status === 'running') {
        // 启动轮询,使用 useEffect 中已建立清理机制的定时器句柄
        const poll = async (): Promise<void> => {
          try {
            const next = await api.getBpStatus(id);
            setBpJob(next);
            if (next.status === 'running') return;
            // 完成/失败,清理轮询
            if (bpTimerRef.current !== null) {
              window.clearInterval(bpTimerRef.current);
              bpTimerRef.current = null;
            }
            if (next.status === 'failed') {
              setBpError(next.error_message ?? '生成失败');
            }
            // success → 自动预览由 useEffect 监听 bpJob.status 转变触发
          } catch {
            if (bpTimerRef.current !== null) {
              window.clearInterval(bpTimerRef.current);
              bpTimerRef.current = null;
            }
          }
        };
        // 立即拉一次,然后开始轮询 (timer 已在 useEffect 清理时重置,这里直接启动)
        await poll();
        if (bpTimerRef.current === null) {
          bpTimerRef.current = window.setInterval(poll, BP_POLL_INTERVAL);
        }
      }
    } catch (err) {
      alert(`触发失败:${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function statusKind(s: string): 'success' | 'warning' | 'failed' | 'analyzing' | 'idle' {
  if (s === 'completed') return 'success';
  if (s === 'failed') return 'failed';
  if (s === 'analyzing') return 'analyzing';
  if (s === 'draft') return 'idle';
  return 'warning';
}

/** 与历史记录页一致的项目名归档键: 移除非法字符 + 截断 60 字符,用于匹配历史文档目录 */
function sanitizeArchiveKey(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

/**
 * 格式化报告生成时间(v1.8 P3-A)
 * - 同一日: "HH:mm"  (如 "14:32")
 * - 当年:    "MM-DD HH:mm"  (如 "09-25 14:32")
 * - 其他年份: "YYYY-MM-DD HH:mm"
 */
function formatReportTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const sameYear = d.getFullYear() === now.getFullYear();
  const sameDay =
    sameYear && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return time;
  if (sameYear) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/** 文档名展示: 去掉 .zip 后缀,名字最多显示 8 个字,超出部分省略(完整名见 title) */
function truncateDocName(filename: string): string {
  const base = filename.replace(/\.zip$/i, '');
  return base.length > 8 ? `${base.slice(0, 8)}…` : base;
}

/**
 * 客户端 OS 探测(用于 PDF 降级时展示对应“另存为 PDF”路径指引)
 *
 * 优先级(v1.7 WARN-01 修复):
 *   1. 桌面端 preload 桥接 window.insightforge?.platform
 *      - Electron 环境可信度最高(无论 UI 偏好语言 / browser 伪装)
 *   2. navigator.platform + userAgent 双检
 *   3. 都不可用时返回 'other'
 */
type ClientOS = 'mac' | 'windows' | 'linux' | 'other';
function detectClientOS(): ClientOS {
  // 1) Electron 桌面端优先
  const deskPlatform = (window as unknown as { insightforge?: { platform?: string } })
    .insightforge?.platform;
  if (deskPlatform) {
    const p = deskPlatform.toLowerCase();
    if (p.includes('darwin') || p.includes('mac')) return 'mac';
    if (p.includes('win32') || p.includes('win')) return 'windows';
    if (p.includes('linux')) return 'linux';
  }
  // 2) 浏览器环境双检
  if (typeof navigator === 'undefined') return 'other';
  const ua = (navigator.userAgent ?? '').toLowerCase();
  const platform = (navigator.platform ?? '').toLowerCase();
  if (platform.includes('mac') || ua.includes('mac')) return 'mac';
  if (platform.includes('win') || ua.includes('windows')) return 'windows';
  if (platform.includes('linux') || ua.includes('linux')) return 'linux';
  return 'other';
}

function osLabel(os: ClientOS): string {
  switch (os) {
    case 'mac':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return '未知系统';
  }
}

/** 根据 OS 返回对应的「另存为 PDF」关键步骤文案 */
function pdfPrintSteps(os: ClientOS): string[] {
  switch (os) {
    case 'mac':
      return [
        '唤起打印对话框:Command (⌘) + P',
        '左下角“PDF”下拉菜单 → 选择「存储为 PDF」',
        '设置文件名与保存路径 → 点「存储」',
      ];
    case 'windows':
      return [
        '唤起打印对话框:Ctrl + P',
        '左侧「目标打印机」下拉中选择「另存为 PDF」(Microsoft Print to PDF)',
        '点「保存」后选择本地路径',
      ];
    case 'linux':
      return [
        '唤起打印对话框:Ctrl + P',
        '依据浏览器不同点击“打印到文件”或“另存为 PDF”',
        '选择本地路径后保存',
      ];
    default:
      return [
        '打开浏览器菜单 → 打印(或使用 Ctrl/Cmd + P)',
        '在打印对话框中选择「另存为 PDF」',
        '设置文件名与路径后保存',
      ];
  }
}
