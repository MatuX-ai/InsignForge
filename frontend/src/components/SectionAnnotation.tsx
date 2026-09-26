/**
 * v1.8 P6-C: 报告章节批注面板
 *
 * 嵌在 Report 页面每个章节标题右侧的「📝 批注」按钮,点击后弹出 Modal,
 * 在 Modal 中可查看 / 新增 / 删除 / 编辑该章节下的本地批注(localStorage)。
 *
 * UI 流程:
 *   1. 默认状态下显示一个紧凑的小按钮,旁边带数量徽标 `📝 3`
 *   2. 点击打开 Modal:
 *      - 顶部统计「共 N 条」
 *      - 列表区:每条批注一行(可编辑/删除)
 *      - 底部 textarea + 「保存」按钮
 *   3. 关闭 Modal 后徽标数字自动更新
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useAnnotations, type Annotation } from '../hooks/useAnnotations';

interface Props {
  projectId: string;
  sectionKey: string;
  sectionLabel: string;
  /** 按钮颜色,与章节标题一致 */
  tone?: 'default' | 'primary' | 'success' | 'danger' | 'warning';
}

/** 把 ISO 时间格式化为中文友好短文案(同一天 HH:mm,不同天 MM-DD HH:mm) */
function formatAnnotationTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mm}`;
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${M}-${D} ${hh}:${mm}`;
}

export function SectionAnnotation({ projectId, sectionKey, sectionLabel, tone = 'default' }: Props) {
  const [open, setOpen] = useState(false);
  const { notes, addNote, deleteNote, updateNote } = useAnnotations(projectId, sectionKey);
  // 当前正在编辑的批注 id(null 表示新增)
  const [editingId, setEditingId] = useState<string | null>(null);
  // textarea 内容
  const [draft, setDraft] = useState('');
  // 触发编辑态变化的 effect:打开 modal 时清空草稿
  useEffect(() => {
    if (open) {
      setEditingId(null);
      setDraft('');
    }
  }, [open]);

  // 数量徽标颜色:有批注时高亮
  const countBadge = useMemo(() => {
    if (notes.length === 0) return null;
    return (
      <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium rounded-full bg-primary/20 text-primary-light border border-primary/30">
        {notes.length}
      </span>
    );
  }, [notes.length]);

  const startEdit = (note: Annotation) => {
    setEditingId(note.id);
    setDraft(note.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (editingId) {
      updateNote(editingId, text);
      setEditingId(null);
    } else {
      addNote(text);
    }
    setDraft('');
  };

  // 当前为简化版本:按钮使用统一的二级文字色,与章节色调无关
  // 保留 tone 参数便于后续按章节色调调整(目前不消费)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-3 inline-flex items-center gap-0.5 text-helper text-text-secondary hover:text-text-primary transition-colors rounded px-1.5 py-0.5 hover:bg-hover-bg"
        title={`「${sectionLabel}」的私人批注`}
        aria-label={`查看「${sectionLabel}」的私人批注,共 ${notes.length} 条`}
      >
        <span aria-hidden>📝</span>
        <span>批注</span>
        {countBadge}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${sectionLabel} · 私人批注`}
        primaryLabel="关闭"
      >
        <div className="space-y-3">
          <div className="text-helper text-text-secondary">
            共 <span className="text-text-primary font-semibold">{notes.length}</span> 条
            批注 · 仅保存在本地浏览器,不发送到服务器。
          </div>

          {/* 已有批注列表 */}
          {notes.length > 0 && (
            <ul className="border border-border rounded-lg divide-y divide-border bg-card-solid/30 max-h-72 overflow-y-auto">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="p-3 text-body text-text-primary"
                >
                  {editingId === n.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={2000}
                        className="w-full min-h-[60px] p-2 text-body bg-card-solid/50 border border-border rounded resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="text-helper text-text-secondary hover:text-text-primary px-2 py-1 rounded"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={submit}
                          className="text-helper text-primary hover:text-primary-light px-2 py-1 rounded"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="whitespace-pre-wrap break-words">{n.text}</div>
                        <div className="mt-1 text-helper text-text-tertiary">
                          {formatAnnotationTime(n.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(n)}
                          className="text-helper text-text-secondary hover:text-primary px-1.5 py-0.5 rounded"
                          title="编辑"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNote(n.id)}
                          className="text-helper text-text-secondary hover:text-red-400 px-1.5 py-0.5 rounded"
                          title="删除"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {notes.length === 0 && !editingId && (
            <div className="text-helper text-text-tertiary text-center py-4">
              还没有批注,在下方写下你的第一条想法吧。
            </div>
          )}

          {/* 新增 textarea(编辑中时隐藏避免重复) */}
          {editingId === null && (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="写下你的私人想法 / 待办 / 灵感..."
                maxLength={2000}
                className="w-full min-h-[72px] p-2 text-body bg-card-solid/50 border border-border rounded resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-tertiary"
              />
              <div className="flex items-center justify-between">
                <div
                  className={`text-label tabular-nums ${
                    draft.length > 1800
                      ? 'text-amber-400'
                      : draft.length > 1500
                        ? 'text-primary-light'
                        : 'text-text-tertiary'
                  }`}
                >
                  {draft.length} / 2000
                </div>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!draft.trim()}
                  className="px-3 py-1 text-body bg-primary text-white rounded hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  保存批注
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
