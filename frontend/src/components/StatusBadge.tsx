/**
 * 状态徽章 - 深色玻璃拟态主题
 * 5 种状态: success / warning / failed / analyzing / idle
 */

type StatusKind = 'success' | 'warning' | 'failed' | 'analyzing' | 'idle';

interface Props {
  kind: StatusKind;
  children?: string;
}

const styleMap: Record<StatusKind, { bg: string; text: string; label: string; border: string }> = {
  success: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    label: '已完成',
  },
  warning: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    label: '等待中',
  },
  failed: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/30',
    label: '失败',
  },
  analyzing: {
    bg: 'bg-primary/10',
    text: 'text-primary-light',
    border: 'border-primary/30',
    label: '进行中',
  },
  idle: {
    bg: 'bg-slate-500/10',
    text: 'text-text-secondary',
    border: 'border-slate-500/30',
    label: '未开始',
  },
};

export function StatusBadge({ kind, children }: Props) {
  const s = styleMap[kind];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-label rounded-md border ${s.bg} ${s.text} ${s.border} backdrop-blur-sm`}
    >
      {children ?? s.label}
    </span>
  );
}
