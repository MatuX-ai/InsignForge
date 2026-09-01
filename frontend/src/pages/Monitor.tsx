/**
 * 系统监控面板(v1.6)
 *
 * 一站式展示系统健康与调度器运行视图,供运维与开发者快速定位问题。
 *
 * 数据源:
 *   - GET /api/v1/health/system         系统组件(DB / LLM / Cache / 旧调度器)
 *   - GET /api/v1/admin/scheduler/status  注册表层全量调度器(v1.6 新增)
 *
 * 刷新策略:
 *   - 进入页面立刻拉取
 *   - 每 10s 自动刷新一次(useEffect + cleanup)
 *   - 失败时保留上一帧数据 + 显示错误条
 */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { api } from '../lib/api';
import type {
  SchedulerJobStatus,
  SchedulerStatusResponse,
  SystemHealthResponse,
} from '../types';

/** 自动刷新间隔(毫秒) */
const REFRESH_INTERVAL_MS = 10_000;

/** 健康状态徽章样式 */
const STATUS_BADGE: Record<SystemHealthResponse['status'], { label: string; cls: string }> = {
  healthy: { label: '健康', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  degraded: { label: '降级', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  unhealthy: { label: '异常', cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
};

/** job running 状态徽章 */
const RUN_BADGE: Record<'true' | 'false', string> = {
  true: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  false: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

/** 格式化毫秒为「N 小时 N 分钟」 */
function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  if (min < 60) return remainSec > 0 ? `${min} 分 ${remainSec} 秒` : `${min} 分钟`;
  const hr = Math.floor(min / 60);
  const remainMin = min % 60;
  return remainMin > 0 ? `${hr} 小时 ${remainMin} 分` : `${hr} 小时`;
}

/** 把 ISO 时间格式化为 HH:mm:ss(本地时区) */
function formatTime(iso: string | null): string {
  if (!iso) return '尚未运行';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 计算 nextRunAt 相对当前剩余秒数 */
function secondsUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}

/** 格式化 uptime(秒) */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  const hr = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return min > 0 ? `${hr} 小时 ${min} 分` : `${hr} 小时`;
}

export function Monitor() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [schedulers, setSchedulers] = useState<SchedulerStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 触发自动刷新的「心跳」,useEffect 依赖它 */
  const [tick, setTick] = useState(0);
  /** 显示用的当前时间(每秒更新) */
  const [now, setNow] = useState(() => new Date());

  /** 同时拉取两个接口,任一失败保留旧数据并展示 */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, s] = await Promise.all([api.getSystemHealth(), api.getSchedulerStatus()]);
      setHealth(h);
      setSchedulers(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // 进入页面 + tick 变化时拉取
  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  // 自动刷新定时器
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // 表层时钟(用于「上次刷新于 X」展示)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const status = health?.status;
  const badge = status ? STATUS_BADGE[status] : null;
  const maxPct = schedulers?.schedulers.reduce(
    (acc, s) => Math.max(acc, s.intervalMs),
    0
  );

  return (
    <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-title text-text-primary">系统监控</h1>
        <div className="flex items-center gap-3">
          {badge && (
            <span
              className={`px-3 py-1 rounded-full border text-helper font-medium ${badge.cls}`}
              aria-label={`系统状态: ${badge.label}`}
            >
              {badge.label}
            </span>
          )}
          <span className="text-helper text-text-secondary">
            上次刷新: {now.toLocaleTimeString()}
          </span>
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
            title="立即刷新"
          >
            {loading ? '刷新中...' : '刷新'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <Banner tone="warning" title="部分接口拉取失败">
            {error}。下方数据可能为上一次成功结果。
          </Banner>
        </div>
      )}

      {/* 顶部总览条 */}
      {health && (
        <Card title="总览" className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Stat label="整体状态" value={badge ? badge.label : '-'} />
            <Stat label="运行时长" value={formatUptime(health.uptime)} />
            <Stat
              label="检查时间"
              value={new Date(health.checkedAt).toLocaleTimeString()}
            />
          </div>
        </Card>
      )}

      {/* 区块 1:系统组件 */}
      {health && (
        <Card title="系统组件" className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* DB */}
            <ComponentCard
              title="数据库"
              tone={health.db.ok ? 'success' : 'danger'}
              rows={[
                {
                  key: '状态',
                  value: health.db.ok ? '✅ 正常' : '❌ 异常',
                },
                { key: '延迟', value: `${health.db.latencyMs} ms` },
                ...(health.db.error
                  ? [{ key: '错误', value: health.db.error, tone: 'danger' as const }]
                  : []),
              ]}
            />

            {/* LLM */}
            <ComponentCard
              title="LLM"
              tone={health.llm.configured ? 'success' : 'warning'}
              rows={[
                { key: 'Provider', value: health.llm.provider },
                { key: 'Model', value: health.llm.model },
                {
                  key: 'API Key',
                  value: health.llm.configured ? '✅ 已配置' : '⚠ 未配置',
                },
              ]}
            />

            {/* Cache */}
            <ComponentCard
              title="LLM 缓存"
              tone={health.cache.enabled ? 'primary' : 'warning'}
              rows={[
                {
                  key: '开关',
                  value: health.cache.enabled ? '✅ 启用' : '⚠ 关闭',
                },
                { key: '总记录', value: `${health.cache.total}` },
                { key: '活跃', value: `${health.cache.active}` },
                { key: '过期', value: `${health.cache.expired}` },
              ]}
            />

            {/* Scheduler(老接口,完整字段在下方"调度器列表") */}
            <ComponentCard
              title="调度器 (旧字段)"
              tone={health.scheduler.running ? 'success' : 'warning'}
              rows={[
                {
                  key: '状态',
                  value: health.scheduler.running ? '✅ 运行中' : '⚠ 未运行',
                },
                {
                  key: '上次清理',
                  value: health.scheduler.lastRemoved !== null
                    ? `${health.scheduler.lastRemoved} 条`
                    : '-',
                },
                {
                  key: '下次执行',
                  value: health.scheduler.nextRunAt
                    ? formatTime(health.scheduler.nextRunAt)
                    : '-',
                },
              ]}
            />
          </div>
        </Card>
      )}

      {/* 区块 2:调度器列表(来自方向 ① 的注册表) */}
      {schedulers && (
        <Card title="后台任务调度器" className="mb-6">
          {schedulers.schedulers.length === 0 ? (
            <div className="text-helper text-text-secondary">
              当前没有已注册的调度任务
            </div>
          ) : (
            <div className="space-y-3">
              {schedulers.schedulers.map((job) => (
                <SchedulerRow
                  key={job.name}
                  job={job}
                  maxInterval={maxPct && maxPct > 0 ? maxPct : job.intervalMs}
                />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 区块 3:issues 列表 */}
      {health && health.issues.length > 0 && (
        <Card title="注意事项" tone="warning" className="mb-6">
          <ul className="space-y-2">
            {health.issues.map((msg, idx) => (
              <li
                key={`${msg}-${idx}`}
                className="text-body text-amber-300 flex items-start gap-2"
              >
                <span className="text-amber-400 mt-0.5">⚠</span>
                <span>{msg}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!health && !schedulers && !error && (
        <Card>
          <div className="text-helper text-text-secondary">
            正在加载监控数据...
          </div>
        </Card>
      )}

      <div className="text-helper text-text-secondary mt-4">
        数据每 {REFRESH_INTERVAL_MS / 1000} 秒自动刷新;面板仅用于运维排查,不对外暴露。
      </div>
    </main>
  );
}

/** 顶部总览条的小统计卡 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card-solid/40 p-4">
      <div className="text-helper text-text-secondary mb-1">{label}</div>
      <div className="text-section text-text-primary font-medium">{value}</div>
    </div>
  );
}

/** 组件卡片(用于系统组件区域) */
function ComponentCard({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: 'success' | 'danger' | 'warning' | 'primary';
  rows: Array<{ key: string; value: string; tone?: 'danger' }>;
}) {
  const borderCls =
    tone === 'success'
      ? 'border-emerald-500/30'
      : tone === 'danger'
        ? 'border-red-500/30'
        : tone === 'warning'
          ? 'border-amber-500/30'
          : 'border-primary/30';
  const titleCls =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'danger'
        ? 'text-red-300'
        : tone === 'warning'
          ? 'text-amber-300'
          : 'text-primary-light';
  return (
    <div className={`rounded-lg border ${borderCls} bg-card-solid/30 p-4`}>
      <div className={`text-section font-medium mb-3 ${titleCls}`}>{title}</div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.key} className="flex justify-between gap-2 text-helper">
            <span className="text-text-secondary shrink-0">{row.key}</span>
            <span
              className={
                row.tone === 'danger'
                  ? 'text-red-300 break-all text-right'
                  : 'text-text-primary text-right break-all'
              }
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 调度任务行(单 job) */
function SchedulerRow({
  job,
  maxInterval,
}: {
  job: SchedulerJobStatus;
  /** 所有 job 中最大的 intervalMs,用于相对宽度(可视化周期对比) */
  maxInterval: number;
}) {
  const nextSec = secondsUntil(job.nextRunAt);
  const widthPct = maxInterval > 0 ? Math.max(2, (job.intervalMs / maxInterval) * 100) : 100;
  return (
    <div className="rounded-lg border border-border bg-card-solid/30 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-medium text-text-primary truncate">{job.name}</span>
          <span
            className={`px-2 py-0.5 text-helper rounded-md border ${RUN_BADGE[job.running ? 'true' : 'false']}`}
          >
            {job.running ? '运行中' : '已停止'}
          </span>
          {job.lastError && (
            <span
              className="px-2 py-0.5 text-helper rounded-md border bg-red-500/10 text-red-300 border-red-500/30"
              title={job.lastError}
            >
              最近失败
            </span>
          )}
        </div>
        <span className="text-helper text-text-secondary">
          周期 {formatDuration(job.intervalMs)}
        </span>
      </div>
      {/* 周期对比条 */}
      <div className="bg-slate-700/40 rounded-full h-1.5 overflow-hidden mb-3">
        <div
          className="bg-gradient-to-r from-primary to-primary-light h-full rounded-full"
          style={{ width: `${widthPct}%` }}
          aria-label={`周期占比 ${Math.round(widthPct)}%`}
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-helper">
        <Field
          label="上次执行"
          value={formatTime(job.lastRunAt)}
          hint={
            job.lastDurationMs !== null ? `耗时 ${formatDuration(job.lastDurationMs)}` : ''
          }
        />
        <Field
          label="上次清理/产出"
          value={
            job.lastRemoved !== null && job.lastRemoved !== undefined
              ? `${job.lastRemoved} 条`
              : '-'
          }
        />
        <Field
          label="下次执行"
          value={job.nextRunAt ? formatTime(job.nextRunAt) : '-'}
          hint={
            nextSec !== null ? `剩余 ${formatDuration(nextSec * 1000)}` : ''
          }
        />
        <Field
          label="首次延迟"
          value={formatDuration(job.firstDelayMs)}
        />
      </div>
      {job.lastError && (
        <div className="mt-3 text-helper text-red-300 break-all">
          最近错误: {job.lastError}
        </div>
      )}
    </div>
  );
}

/** 字段(key + value + 可选 hint) */
function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-text-secondary mb-0.5">{label}</div>
      <div className="text-text-primary font-medium">{value}</div>
      {hint && <div className="text-text-tertiary mt-0.5">{hint}</div>}
    </div>
  );
}