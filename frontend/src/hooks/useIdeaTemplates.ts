/**
 * v1.8 P7-A: 我的想法模板 (本地存储)
 *
 * 用户在 Home 页保存自己常用的「想法 + 标签」组合,后续调研时一键复用。
 * 适用场景:
 *   - 同一赛道反复调研(如连续做 N 个 SaaS 想法)
 *   - 同类项目复用描述模板(如「一个帮助 XXX 的工具」)
 *   - 不想重复输入相同关键词
 *
 * 设计:
 *   - 存储键 insightforge:idea-templates:v1
 *   - 结构:IdeaTemplate[] = [{ id, label, idea, tag?, createdAt }]
 *   - 上限 50 条;超出按 createdAt 升序裁剪最旧
 *   - 单条 idea 上限 500 字(与 Home 输入框一致),label 30 字
 *   - 损坏的 JSON 不抛错,直接回退到空数组
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'insightforge:idea-templates:v1';
const MAX_TEMPLATES = 50;
const MAX_IDEA_LENGTH = 500;
const MAX_LABEL_LENGTH = 30;
const MAX_TAG_LENGTH = 12;

export interface IdeaTemplate {
  id: string;
  /** 简短标识,如「我的 SaaS 工具模板」 */
  label: string;
  /** 完整想法描述,填入输入框 */
  idea: string;
  /** 可选标签(如 SaaS / 工具 / AI),显示在 chip 上 */
  tag?: string;
  createdAt: string;
}

/** 读盘:失败回退空数组 */
function readAll(): IdeaTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 简化过滤:丢掉明显无效的项
    return parsed.filter(
      (it): it is IdeaTemplate =>
        it &&
        typeof it.id === 'string' &&
        typeof it.label === 'string' &&
        typeof it.idea === 'string' &&
        typeof it.createdAt === 'string',
    );
  } catch {
    return [];
  }
}

/** 写盘:失败仅 console.warn */
function writeAll(list: IdeaTemplate[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[useIdeaTemplates] localStorage 写入失败:', err);
  }
}

/** 简易 ID 生成 */
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 截断过长字段 */
function trimIdea(s: string): string {
  return s.length > MAX_IDEA_LENGTH ? s.slice(0, MAX_IDEA_LENGTH) : s;
}
function trimLabel(s: string): string {
  return s.length > MAX_LABEL_LENGTH ? s.slice(0, MAX_LABEL_LENGTH) : s;
}
function trimTag(s: string): string {
  return s.length > MAX_TAG_LENGTH ? s.slice(0, MAX_TAG_LENGTH) : s;
}

export function useIdeaTemplates() {
  const [templates, setTemplates] = useState<IdeaTemplate[]>([]);

  // 初始读盘
  useEffect(() => {
    setTemplates(readAll());
  }, []);

  const addTemplate = useCallback(
    (input: { label: string; idea: string; tag?: string }): IdeaTemplate | null => {
      const label = trimLabel(input.label.trim());
      const idea = trimIdea(input.idea.trim());
      const tag = input.tag?.trim() ? trimTag(input.tag.trim()) : undefined;
      if (!label || !idea) return null;
      const tmpl: IdeaTemplate = {
        id: genId(),
        label,
        idea,
        tag,
        createdAt: new Date().toISOString(),
      };
      setTemplates((prev: IdeaTemplate[]) => {
        const next = [tmpl, ...prev];
        const capped = next.length > MAX_TEMPLATES ? next.slice(0, MAX_TEMPLATES) : next;
        writeAll(capped);
        return capped;
      });
      return tmpl;
    },
    [],
  );

  const removeTemplate = useCallback((id: string) => {
    setTemplates((prev: IdeaTemplate[]) => {
      const next = prev.filter((t: IdeaTemplate) => t.id !== id);
      writeAll(next);
      return next;
    });
  }, []);

  const renameTemplate = useCallback((id: string, label: string) => {
    const trimmed = trimLabel(label.trim());
    if (!trimmed) return;
    setTemplates((prev: IdeaTemplate[]) => {
      const next = prev.map((t: IdeaTemplate) => (t.id === id ? { ...t, label: trimmed } : t));
      writeAll(next);
      return next;
    });
  }, []);

  const hasTemplate = useCallback(
    (label: string): boolean => {
      const target = label.trim();
      return templates.some((t: IdeaTemplate) => t.label === target);
    },
    [templates],
  );

  return { templates, addTemplate, removeTemplate, renameTemplate, hasTemplate };
}
