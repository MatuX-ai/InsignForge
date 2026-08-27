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
import { ResearchProgress } from '../components/ResearchProgress';
import { api } from '../lib/api';
import { useResearch } from '../hooks/useResearch';
import type {
  DocsJob,
  BpJob,
  MarketReport,
  Project,
  ReportCompetitor,
  TechStackPlan,
  FrontendDesignPlan,
  DocVersion,
  HistoryArchives,
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
  /** 商业计划书下载中(用于按钮 loading) */
  const [bpDownloading, setBpDownloading] = useState(false);
  /** 商业计划书轮询定时器句柄 */
  const bpTimerRef = useRef<number | null>(null);
  /** 复制成功提示 */
  const [copySuccess, setCopySuccess] = useState(false);
  /** 落地页预览弹窗 */
  const [landingPreview, setLandingPreview] = useState<string | null>(null);
  /** 落地页生成中 */
  const [landingLoading, setLandingLoading] = useState(false);
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
        // eslint-disable-next-line no-console
        console.warn('docs poll failed:', err);
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
        // eslint-disable-next-line no-console
        console.warn('bp poll failed:', err);
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

  // 生成落地页
  const handleGenerateLanding = async () => {
    if (!id) return;
    setLandingLoading(true);
    try {
      const result = await api.generateLanding(id);
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
  const [duplicating, setDuplicating] = useState(false);
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
    if (!window.insightforge?.openPath) {
      await dialog.alert({
        title: '桌面端专属功能',
        message: '仅桌面端支持直接打开归档文件。',
        tone: 'warning',
      });
      return;
    }
    const fullPath = `${projectArchive.dir}\\${file}`;
    const res = await window.insightforge.openPath(fullPath);
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
      <main className="flex-1 px-6 py-10 max-w-3xl mx-auto">
        <Card>
          <div className="text-red-600">加载失败:{loadError}</div>
          <div className="mt-4">
            <Button variant="text" onClick={() => navigate('/')}>
              ← 返回首页
            </Button>
          </div>
        </Card>
      </main>
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
      <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
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

        {isAnalyzing && (
          <Card title="调研分析中...">
            <ResearchProgress
              progress={status?.progress ?? '准备中...'}
              currentStep={status?.execution.current_step ?? ''}
              startedAt={status?.execution.started_at ?? new Date().toISOString()}
            />
          </Card>
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
                primaryLabel="下载商业计划书包"
                primaryLoading={bpDownloading}
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

        {/* 调研失败 Banner - 展示错误信息,提供手动重试入口 */}
        {error && (
          <div className="my-6">
            <Banner
              tone="error"
              title="调研失败"
              action={
                retryAttempt === 0
                  ? {
                      label: '重试',
                      onClick: () => void retry(),
                    }
                  : undefined
              }
            >
              {error}
              {retryAttempt > 0 && (
                <div className="mt-2 text-text-secondary">
                  🔄 正在自动重试 ({retryAttempt} / 3)…
                </div>
              )}
            </Banner>
          </div>
        )}

        {currentReport && (
          <>
            {/* 章节导航 - 横向滚动胶囊,移动端友好 */}
            <ReportToc items={TOC_SECTIONS} />

            {/* 章节断点辅助样式:让每个 section 之间有明显的视觉分隔,便于长报告扫读 */}
            {/* 1. 执行摘要 - 顶部不需断点 */}
            <section id="section-summary" className="mb-6">
              <Card title="执行摘要">
                <p className="text-body text-text-primary leading-relaxed">
                  {currentReport.summary}
                </p>
              </Card>
            </section>

            {/* 2. 市场热度 - 可视化增强 */}
            <section id="section-heat" className="mt-10 pt-8 border-t border-border/30">
              <Card title="市场热度">
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
                <Card title="行动建议" tone="primary">
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
              <Card title="竞品识别">
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

            {/* 5. 竞品对比矩阵 */}
            {currentReport.competitors.length >= 2 && (
              <section id="section-compare" className="mt-10 pt-8 border-t border-border/30">
                <Card title="竞品对比矩阵">
                  <div className="overflow-x-auto">
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
                </Card>
              </section>
            )}

            {/* 6. 用户痛点 */}
            <section id="section-pain" className="mt-10 pt-8 border-t border-border/30">
              <Card title="用户痛点">
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

            {/* 7. 市场规模 */}
            <section id="section-market-size" className="mt-10 pt-8 border-t border-border/30">
              <Card title="市场规模估算">
                <p className="text-body">{currentReport.market_size}</p>
              </Card>
            </section>

            {/* 8. 风险与机会 */}
            <section id="section-risk-opp" className="mt-10 pt-8 border-t border-border/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card title="风险">
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
                <Card title="机会">
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

            {/* 9. 数据来源 - 章节断点(顶部边框) */}
            <section
              id="section-sources"
              className="mt-12 pt-8 border-t border-border/40"
            >
              <Card title="数据来源">
                {currentReport.sources.length === 0 ? (
                  <div className="text-helper text-text-secondary">暂无来源</div>
                ) : (
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
                        label: '🖨️ 打印报告',
                        onClick: () => window.print(),
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
                    loading={bpJob?.status === 'running' || bpDownloading}
                    disabled={
                      exportBusy !== null ||
                      bpJob?.status === 'running' ||
                      bpDownloading
                    }
                    onClick={() => handleGenerateBp()}
                  >
                    {bpDownloading
                      ? '下载中...'
                      : bpJob?.status === 'running'
                        ? '生成中...'
                        : bpJob?.status === 'success'
                          ? '下载商业计划书'
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

        {!isAnalyzing && !currentReport && !loadError && (
          <Card>
            <div className="text-text-secondary">该调研尚未开始或已完成但未生成报告</div>
            <div className="mt-4 flex gap-2">
              <Link
                to="/"
                className="text-primary hover:underline text-[15px]"
              >
                ← 返回首页
              </Link>
            </div>
          </Card>
        )}

        <LlmSetupPrompt
          open={!loading && errorCode === 'MISSING_API_KEY'}
          errorCode={errorCode}
          onClose={() => {
            reset();
          }}
          onGoSettings={() => navigate('/settings')}
        />
      </main>

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
              <h3 className="text-lg font-medium text-text-primary">验证落地页预览</h3>
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

      {/* 版本选择 + 选型引导弹窗 */}
      {showVersionSelect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 no-print p-4">
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
        const useBrowserPrint = await dialog.confirm({
          title: 'PDF 导出降级',
          message:
            '后端未配置 PDF 生成器 (未检测到系统中的 Chrome/Edge/Chromium)。\n是否改用浏览器内置打印?在打印预览对话框选择 "另存为 PDF" 即可。',
          primaryLabel: '使用浏览器打印',
          secondaryLabel: '取消',
          tone: 'warning',
        });
        if (useBrowserPrint) {
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
   * 生成/下载商业计划书
   *   - 未生成或已失败: 触发生成,启动轮询
   *   - 生成成功: 下载 ZIP
   * 函数声明会被 hoisting,JSX 中可直接引用
   */
  async function handleGenerateBp(): Promise<void> {
    if (!id) return;

    // 成功 → 下载
    if (bpJob?.status === 'success') {
      setBpDownloading(true);
      try {
        downloadUrl(api.bpDownloadUrl(id));
      } catch (err) {
        await dialog.alert({
          title: '下载失败',
          message: err instanceof Error ? err.message : String(err),
          tone: 'danger',
        });
      } finally {
        setBpDownloading(false);
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

/** 文档名展示: 去掉 .zip 后缀,名字最多显示 8 个字,超出部分省略(完整名见 title) */
function truncateDocName(filename: string): string {
  const base = filename.replace(/\.zip$/i, '');
  return base.length > 8 ? `${base.slice(0, 8)}…` : base;
}
