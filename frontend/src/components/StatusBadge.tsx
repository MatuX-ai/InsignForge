/**
 * 状态徽章 - 按前端设计文档 §2.3 颜色
 * 仅 success / warning / failed / analyzing 四种
 */

type StatusKind = 'success' | 'warning' | 'failed' | 'analyzing' | 'idle';

interface Props {
  kind: StatusKind;
  children?: string;
}

const styleMap: Record<StatusKind, { bg: string; text: string; label: string }> = {
  success: { bg: 'bg-green-50', text: 'text-success', label: '已完成' },
  warning: { bg: 'bg-amber-50', text: 'text-warning', label: '等待中' },
  failed: { bg: 'bg-red-50', text: 'text-red-600', label: '失败' },
  analyzing: { bg: 'bg-blue-50', text: 'text-primary', label: '进行中' },
  idle: { bg: 'bg-gray-100', text: 'text-text-secondary', label: '未开始' },
};

export function StatusBadge({ kind, children }: Props) {
  const s = styleMap[kind];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-label rounded ${s.bg} ${s.text}`}
    >
      {children ?? s.label}
    </span>
  );
}