/**
 * ResearchLoadingPanel - 调研过渡面板(vNext)
 *
 * 替代原先简化的"调研分析中..."卡片,在桌面端【马上验证想法】后展示。
 * 设计目标:
 *   1. 让用户"感觉 AI 在努力工作"——走马灯横条 + 阶段时间线 + 数据瀑布
 *   2. 用时测算更直观——已耗时 + 阶段位置 + 剩余时间估算(ETA)
 *   3. 数据透明——展示本次调研实际从哪些数据源、采到了多少条数据
 *
 * 输入:
 *   - progress  后端写入的当前阶段文案(来自 project.progress)
 *   - currentStep 后端写入的步骤名(来自 execution.current_step)
 *   - startedAt 调研开始时间
 *   - metrics  后端实时返回的数据瀑布 / 数据源统计
 *
 * 输出:无副作用,纯展示。
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  ExecutionMetrics,
  ExecutionMetricSample,
  ExecutionMetricBucket,
} from '../types';

/**
 * 调研的"概念阶段"——与 MarketResearcher.run 内部的步骤一一对应。
 * 用模糊匹配 progress 文本,识别当前阶段位置,供 ETA 与时间线使用。
 *
 * 优先级靠后: 第一个关键词匹配生效,所以"正在整合"必须在"正在抽取"前,
 * 因为 progress 文案不会重复,但关键词文本可能误命中后续阶段。
 */
const STAGES: ReadonlyArray<{
  id: string;
  label: string;
  /** 命中 progress/currentStep 文本即可认为进入此阶段(不区分大小写) */
  keywords: ReadonlyArray<string>;
}> = [
  { id: 'keyword', label: 'AI 拆解关键词', keywords: ['拆解搜索关键词', 'extract keyword', '关键词'] },
  { id: 'expand', label: '关键词扩展', keywords: ['同义词', '长尾词', '关键词扩展', 'keyword expand'] },
  { id: 'collect', label: '多源数据采集', keywords: ['并行搜索', '多源', '数据采集中', '多源采集', 'aggregat'] },
  { id: 'pain', label: 'AI 抽取痛点', keywords: ['抽取用户痛点', '结构化痛点', '抽取痛点', 'pain point'] },
  { id: 'report', label: '整合生成报告', keywords: ['整合数据生成报告', '生成报告', 'report generation'] },
  { id: 'done', label: '收尾归档', keywords: ['报告已生成', '已完成', '归档'] },
];

/** 走马灯横条的预设"AI 思考"短句,作为 progress 文案的补足,让横条不会空荡 */
const MARQUEE_FILLERS: ReadonlyArray<string> = [
  '正在阅读 Reddit 上的用户吐槽…',
  '正在抓取 HackerNews 的相关讨论…',
  '正在扫描 Google / Bing 上的最新资讯…',
  '正在按标题相似度去重合并…',
  '正在让 LLM 给候选打分排序…',
  '正在抽取高频出现的痛点…',
  '正在把不同来源的数据对齐到统一 schema…',
  '正在为每个候选竞争者补全优劣…',
  '正在估算市场规模与年复合增长…',
  '正在写报告的执行摘要…',
];

/** 数据源展示名 + 图标(emoji 即可,不引入额外依赖) */
const SOURCE_META: Record<string, { label: string; emoji: string; tone: string }> = {
  reddit:      { label: 'Reddit',     emoji: '🟠', tone: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  hackernews:  { label: 'HackerNews', emoji: '🟧', tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  google:      { label: 'Google',     emoji: '🔍', tone: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  bing:        { label: 'Bing',       emoji: '🟦', tone: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  producthunt: { label: 'ProductHunt',emoji: '🚀', tone: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
};
const DEFAULT_SOURCE_META = { label: '其他来源', emoji: '📦', tone: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };

function formatElapsed(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return s === 0 ? `${m} 分钟` : `${m} 分 ${s.toString().padStart(2, '0')} 秒`;
}

function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '计算中';
  if (sec < 30) return '即将完成';
  return formatElapsed(sec);
}

/**
 * 从 progress/currentStep 推断当前处于哪一阶段(0-based index)。
 * 找不到匹配返回 0(开头),让时间线至少高亮第一阶段而不是空白。
 */
function detectStageIndex(progress: string, currentStep: string): number {
  const text = `${progress ?? ''}\n${currentStep ?? ''}`.toLowerCase();
  if (!text.trim()) return 0;
  for (let i = 0; i < STAGES.length; i++) {
    const kws = STAGES[i]!.keywords;
    if (kws.some((kw) => text.includes(kw.toLowerCase()))) return i;
  }
  return 0;
}

interface ResearchLoadingPanelProps {
  /** 后端写入的当前阶段文案(原始) */
  progress: string;
  /** 后端写入的当前步骤名 */
  currentStep: string;
  /** 调研开始时间(ISO),用于已耗时 */
  startedAt: string;
  /** 后端实时返回的瀑布 / 数据源指标;running 期间为对象,否则为 null */
  metrics: ExecutionMetrics | null;
  className?: string;
}

export function ResearchLoadingPanel({
  progress,
  currentStep,
  startedAt,
  metrics,
  className = '',
}: ResearchLoadingPanelProps) {
  // ----- 已耗时:每秒刷新一次 -----
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const startMs = useMemo(() => new Date(startedAt).getTime(), [startedAt]);
  const elapsedSec = startMs > 0 ? Math.max(0, (now - startMs) / 1000) : 0;

  // ----- 当前阶段索引(用于时间线 + ETA 推算) -----
  const stageIndex = useMemo(
    () => detectStageIndex(progress, currentStep),
    [progress, currentStep]
  );
  const stageTotal = STAGES.length;

  // ----- ETA 估算 -----
  // 思路: JobProgressItem.EtaBadge 用的 10s 启动窗 + 速率法,迁移过来。
  // 不同点: 没有 progress/total 这种离散步骤,所以用"阶段位置 + 已耗时"
  //       做加权外推。启动 10s 内样本不足 → 显示"计算中"。
  const eta = useMemo(() => {
    if (elapsedSec < 10) return null;
    // 已完成所有阶段 → 不显示
    if (stageIndex >= stageTotal - 1) return 0;
    // 进度比例(已走阶段 / 总阶段),最差也得有个下限
    const finishedRatio = Math.max(0.05, stageIndex / stageTotal);
    const totalEstimated = elapsedSec / finishedRatio;
    return Math.max(0, totalEstimated - elapsedSec);
  }, [elapsedSec, stageIndex, stageTotal]);

  // ----- 走马灯内容 -----
  // 拼接 progress 文案 + 一组预设,组成可循环播放的"AI 思考"长串
  const marqueeItems = useMemo(() => {
    const head = progress?.trim() || currentStep?.trim() || '正在组织调研任务…';
    // 把 head 放在最前,让用户第一眼能看到"现在具体在做什么"
    return [head, ...MARQUEE_FILLERS];
  }, [progress, currentStep]);

  return (
    <div
      className={`bg-card backdrop-blur-xl border border-border rounded-card p-5 shadow-glass ${className}`}
    >
      {/* ===== 标题 + 走马灯横条 ===== */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary-light stage-pulse"
          title="AI 在工作"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2 L14 9 L21 10 L16 15 L18 22 L12 18 L6 22 L8 15 L3 10 L10 9 Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-semibold text-text-primary leading-tight">
            AI 正在为你工作
          </h2>
          <p className="text-helper text-text-secondary mt-0.5">
            {progress?.trim() || currentStep?.trim() || '正在组织调研任务…'}
            <span className="dot-1">.</span>
            <span className="dot-2">.</span>
            <span className="dot-3">.</span>
          </p>

          {/* 走马灯横条 */}
          <div
            className="research-marquee mt-3 h-7 rounded-md border border-border bg-bg-secondary/50 text-helper text-text-secondary"
            aria-label="AI 思考进度"
          >
            <div className="research-marquee__track h-full items-center">
              {/* 两段拼接:translateX(-50%) 滚到第二段起点,视觉上等于无缝循环 */}
              <div className="research-marquee__segment h-full items-center">
                {marqueeItems.map((s, i) => (
                  <span key={`a-${i}`} className="px-1 whitespace-nowrap">
                    <span className="text-primary-light">▸</span> {s}
                  </span>
                ))}
              </div>
              <div className="research-marquee__segment h-full items-center" aria-hidden>
                {marqueeItems.map((s, i) => (
                  <span key={`b-${i}`} className="px-1 whitespace-nowrap">
                    <span className="text-primary-light">▸</span> {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 进度指标条: 已耗时 / 阶段 / 剩余 ===== */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-helper text-text-secondary tabular-nums">
        <span title="已耗时">
          <span className="text-text-tertiary">已耗时</span>{' '}
          <span className="text-text-primary">{formatElapsed(elapsedSec)}</span>
        </span>
        <span className="text-text-tertiary">·</span>
        <span title="阶段位置">
          <span className="text-text-tertiary">阶段</span>{' '}
          <span className="text-text-primary">
            {Math.min(stageIndex + 1, stageTotal)} / {stageTotal}
          </span>
        </span>
        <span className="text-text-tertiary">·</span>
        <span title="基于已耗时与阶段位置的剩余时间估算">
          <span className="text-text-tertiary">剩余</span>{' '}
          <span className="text-primary-light">
            {eta === null
              ? '计算中…'
              : stageIndex >= stageTotal - 1
                ? '即将完成'
                : `约 ${formatEta(eta)}`}
          </span>
        </span>
        {metrics && metrics.buckets.length > 0 && (
          <>
            <span className="text-text-tertiary">·</span>
            <span title="本次调研已采集到的数据条数">
              <span className="text-text-tertiary">已采</span>{' '}
              <span className="text-emerald-400">
                {metrics.buckets.reduce((sum, b) => sum + b.count, 0)} 条
              </span>
            </span>
          </>
        )}
      </div>

      {/* ===== 阶段时间线 ===== */}
      <ol className="mt-5 grid grid-cols-6 gap-2" aria-label="调研阶段进度">
        {STAGES.map((stage, idx) => {
          const isDone = idx < stageIndex;
          const isCurrent = idx === stageIndex;
          const isPending = idx > stageIndex;
          return (
            <li
              key={stage.id}
              className="flex flex-col items-center gap-1.5 min-w-0"
              title={stage.label}
            >
              <div className="relative w-full h-1 rounded-full bg-border overflow-hidden">
                {/* 已完成段:实色;当前段:indeterminate 风格脉冲 */}
                <div
                  className={`absolute inset-y-0 left-0 ${
                    isDone
                      ? 'w-full bg-emerald-500/70'
                      : isCurrent
                        ? 'w-1/2 bg-primary-light'
                        : 'w-0'
                  }`}
                />
              </div>
              <div
                className={[
                  'inline-flex h-5 w-5 items-center justify-center rounded-full text-label leading-none transition-colors',
                  isDone
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 stage-check-pop'
                    : isCurrent
                      ? 'bg-primary/20 text-primary-light border border-primary-light stage-pulse'
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
                      ? 'text-primary-light'
                      : 'text-text-tertiary'
                }`}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* ===== 数据瀑布面板 ===== */}
      <DataWaterfall metrics={metrics} />
    </div>
  );
}

/**
 * 数据瀑布子组件
 * - 顶部:数据源 chip + 条数
 * - 主体:最近采集到的样本(终端式逐行滚入)
 * - 空态:友好提示"AI 正在抓取第一手数据..."
 */
function DataWaterfall({ metrics }: { metrics: ExecutionMetrics | null }) {
  return (
    <section
      className="mt-5 rounded-lg border border-border bg-bg-secondary/40 overflow-hidden"
      aria-label="数据瀑布"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-secondary/60">
        <div className="flex items-center gap-2 text-helper text-text-secondary">
          <span aria-hidden className="text-primary-light">⚡</span>
          <span className="font-medium text-text-primary">实时数据瀑布</span>
          <span className="text-text-tertiary">AI 正在从公开来源采集数据</span>
        </div>
        {metrics && metrics.buckets.length > 0 && (
          <span className="text-helper text-text-tertiary tabular-nums">
            共 {metrics.buckets.reduce((s, b) => s + b.count, 0)} 条
          </span>
        )}
      </header>

      {/* 数据源 chip 行 */}
      {metrics && metrics.buckets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-border">
          {metrics.buckets.map((b) => (
            <SourceChip key={b.source} bucket={b} />
          ))}
        </div>
      ) : null}

      {/* 瀑布条目:固定高度,溢出滚动,新条目有入场动画 */}
      <div className="max-h-48 overflow-y-auto px-1 py-1 text-helper">
        {metrics && metrics.samples.length > 0 ? (
          metrics.samples.map((s, i) => <WaterfallRow key={`${s.crawled_at}-${i}`} sample={s} />)
        ) : (
          <EmptyWaterfall />
        )}
      </div>
    </section>
  );
}

/** 数据源 chip: 来源名 + emoji + 条数 */
function SourceChip({ bucket }: { bucket: ExecutionMetricBucket }) {
  const meta = SOURCE_META[bucket.source] ?? {
    ...DEFAULT_SOURCE_META,
    label: String(bucket.source),
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-label ${meta.tone}`}
      title={`${meta.label}: ${bucket.count} 条`}
    >
      <span aria-hidden>{meta.emoji}</span>
      <span>{meta.label}</span>
      <span className="ml-0.5 tabular-nums text-text-primary">×{bucket.count}</span>
    </span>
  );
}

/** 瀑布单行: 来源 + 标题 + 互动量 */
function WaterfallRow({ sample }: { sample: ExecutionMetricSample }) {
  const meta = SOURCE_META[sample.source] ?? {
    ...DEFAULT_SOURCE_META,
    label: String(sample.source),
  };
  return (
    <div
      className="waterfall-row flex items-start gap-2 px-2 py-1 rounded hover:bg-hover-bg/60"
      title={sample.title}
    >
      <span
        className={`shrink-0 mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-label ${meta.tone}`}
      >
        <span aria-hidden>{meta.emoji}</span>
        <span className="tabular-nums text-text-primary">×{Math.max(0, sample.engagement)}</span>
      </span>
      <a
        href={sample.url ?? undefined}
        target="_blank"
        rel="noreferrer noopener"
        className="flex-1 min-w-0 text-text-primary hover:text-primary-light transition-colors truncate"
      >
        {sample.title}
      </a>
      <time className="shrink-0 text-text-tertiary tabular-nums">
        {formatRelativeTime(sample.crawled_at)}
      </time>
    </div>
  );
}

/** 瀑布空态 */
function EmptyWaterfall() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-6 text-text-tertiary">
      <div className="flex items-center gap-1 text-primary-light">
        <span>等待第一批数据流入</span>
        <span className="dot-1">.</span>
        <span className="dot-2">.</span>
        <span className="dot-3">.</span>
      </div>
      <p className="text-label">
        AI 正在按关键词向 Reddit / HackerNews / Google 等来源发起检索
      </p>
    </div>
  );
}

/**
 * 把 ISO 时间渲染成"刚刚 / 几秒前 / 几分钟前",瀑布面板上时间戳尽量短,
 * 避免每行都被长字符串占满。超过 1 小时回退到 HH:mm:ss。
 */
function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return '';
  const diff = Math.max(0, (Date.now() - t) / 1000);
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${Math.floor(diff)} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  const d = new Date(t);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}