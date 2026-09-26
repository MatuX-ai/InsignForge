/**
 * v1.8 P6-C: 报告章节个人批注 (本地存储)
 *
 * 用户在 Report 页某个章节下添加的私人笔记,保存在 localStorage,
 * 不上传到服务器,刷新页面 / 重启客户端后仍然存在。
 *
 * 设计:
 *   - 存储键 insightforge:annotations:v1,JSON 结构:
 *     { [projectId: string]: { [sectionKey: string]: Annotation[] } }
 *   - 每条批注: { id, text, createdAt }
 *   - 提供按项目 + 章节的增删改 API,UI 层只关心返回的数组即可
 *   - 与项目状态解耦: 即使项目被删除,批注也保留,以便日后
 *     「恢复归档」时一并回看(后续迭代可加导出 JSON 备份)
 *
 * 限制:
 *   - 单条批注 ≤ 2000 字,过长会被截断并 console.warn 提示
 *   - 单项目章节下最多保留 100 条;超出时最早的会被丢弃
 *   - 整个 localStorage 配额上限约 5MB,10 年份约 1MB,完全够用
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'insightforge:annotations:v1';
const MAX_NOTES_PER_SECTION = 100;
const MAX_NOTE_LENGTH = 2000;

export interface Annotation {
  id: string;
  text: string;
  createdAt: string;
}

type AnnotationsByProject = Record<string, Record<string, Annotation[]>>;

/** 读盘:从 localStorage 解析,失败回退到空对象 */
function readAll(): AnnotationsByProject {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as AnnotationsByProject;
    return {};
  } catch {
    // 损坏的 JSON 不抛错,直接重置
    return {};
  }
}

/** 写盘:写入整个对象,失败时 console.warn 不抛错 */
function writeAll(all: AnnotationsByProject): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('[useAnnotations] localStorage 写入失败:', err);
  }
}

/** 简单的唯一 ID 生成(避免引入 uuid 依赖) */
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 截断过长的批注文本,避免 localStorage 被刷爆 */
function trimText(text: string): string {
  if (text.length <= MAX_NOTE_LENGTH) return text;
  console.warn(`[useAnnotations] 单条批注超过 ${MAX_NOTE_LENGTH} 字,已自动截断`);
  return text.slice(0, MAX_NOTE_LENGTH);
}

/** 把新增的批注塞进数组头部,并裁剪到最大长度 */
function pushWithCap(list: Annotation[], note: Annotation): Annotation[] {
  const next = [note, ...list];
  if (next.length > MAX_NOTES_PER_SECTION) {
    return next.slice(0, MAX_NOTES_PER_SECTION);
  }
  return next;
}

/**
 * 报告批注 hook — 给定 projectId + sectionKey,返回该章节下的批注列表与增删改 API
 *
 * @param projectId  报告项目 ID;为空字符串时所有操作都无效(初始加载状态)
 * @param sectionKey 章节 ID(如 'section-summary')
 */
export function useAnnotations(projectId: string, sectionKey: string) {
  const [all, setAll] = useState<AnnotationsByProject>({});

  // 初始读盘:只跑一次即可
  useEffect(() => {
    setAll(readAll());
  }, []);

  // 派生:当前 projectId + sectionKey 下的批注数组
  const notes: Annotation[] =
    (projectId && all[projectId]?.[sectionKey]) || [];

  const addNote = useCallback(
    (rawText: string) => {
      const text = trimText(rawText.trim());
      if (!text || !projectId) return;
      const note: Annotation = {
        id: genId(),
        text,
        createdAt: new Date().toISOString(),
      };
      setAll((prev: AnnotationsByProject) => {
        const proj = prev[projectId] ?? {};
        const list = proj[sectionKey] ?? [];
        const next: AnnotationsByProject = {
          ...prev,
          [projectId]: {
            ...proj,
            [sectionKey]: pushWithCap(list, note),
          },
        };
        writeAll(next);
        return next;
      });
    },
    [projectId, sectionKey],
  );

  const deleteNote = useCallback(
    (noteId: string) => {
      if (!projectId) return;
      setAll((prev: AnnotationsByProject) => {
        const proj = prev[projectId];
        if (!proj || !proj[sectionKey]) return prev;
        const next: AnnotationsByProject = {
          ...prev,
          [projectId]: {
            ...proj,
            [sectionKey]: proj[sectionKey].filter((n: Annotation) => n.id !== noteId),
          },
        };
        writeAll(next);
        return next;
      });
    },
    [projectId, sectionKey],
  );

  const updateNote = useCallback(
    (noteId: string, rawText: string) => {
      const text = trimText(rawText.trim());
      if (!text || !projectId) return;
      setAll((prev: AnnotationsByProject) => {
        const proj = prev[projectId];
        if (!proj || !proj[sectionKey]) return prev;
        const next: AnnotationsByProject = {
          ...prev,
          [projectId]: {
            ...proj,
            [sectionKey]: proj[sectionKey].map((n: Annotation) =>
              n.id === noteId ? { ...n, text, createdAt: new Date().toISOString() } : n,
            ),
          },
        };
        writeAll(next);
        return next;
      });
    },
    [projectId, sectionKey],
  );

  return { notes, addNote, deleteNote, updateNote };
}

/** 工具:获取一个项目下所有章节的批注数量统计(给 ReportToc 用) */
export function countAnnotationsBySection(
  projectId: string,
  sectionKeys: ReadonlyArray<string>
): Record<string, number> {
  const all = readAll();
  const proj = projectId ? all[projectId] ?? {} : {};
  const out: Record<string, number> = {};
  for (const k of sectionKeys) {
    out[k] = proj[k]?.length ?? 0;
  }
  return out;
}
