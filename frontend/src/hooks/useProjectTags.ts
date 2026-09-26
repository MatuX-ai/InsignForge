/**
 * v1.8 P7-B: 历史项目标签 (本地存储)
 *
 * 用户可给历史调研项目打自定义标签(如「SaaS / AI 工具 / 已上线 / 待复盘」),
 * 方便从长列表里快速定位同类项目。
 *
 * 设计:
 *   - 存储键 insightforge:project-tags:v1
 *   - 结构:{ [projectId]: tag[] }
 *   - 单个 tag 上限 12 字,每个项目最多 5 个 tag
 *   - 全局唯一 tag 用于筛选栏(自动从所有项目中聚合)
 *   - 损坏的 JSON 不抛错,回退到空 Map
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'insightforge:project-tags:v1';
const MAX_TAGS_PER_PROJECT = 5;
const MAX_TAG_LENGTH = 12;

export type ProjectTagsByProject = Record<string, string[]>;

export interface UseProjectTagsApi {
  tagsByProject: ProjectTagsByProject;
  getTags: (projectId: string) => string[];
  addTag: (projectId: string, tag: string) => boolean;
  removeTag: (projectId: string, tag: string) => void;
  setTags: (projectId: string, tags: string[]) => void;
  hasTag: (projectId: string, tag: string) => boolean;
  /** 聚合所有项目的唯一 tag,按出现频次倒序 */
  allTags: string[];
  /** 出现频次字典:tag -> 计数 */
  tagCounts: Record<string, number>;
}

function readAll(): ProjectTagsByProject {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ProjectTagsByProject = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.every((it) => typeof it === 'string')) {
        out[k] = v.slice(0, MAX_TAGS_PER_PROJECT);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(map: ProjectTagsByProject): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('[useProjectTags] localStorage 写入失败:', err);
  }
}

function trimTag(s: string): string {
  return s.length > MAX_TAG_LENGTH ? s.slice(0, MAX_TAG_LENGTH) : s;
}

export function useProjectTags(): UseProjectTagsApi {
  const [tagsByProject, setTagsByProject] = useState<ProjectTagsByProject>({});

  useEffect(() => {
    setTagsByProject(readAll());
  }, []);

  const getTags = useCallback(
    (projectId: string): string[] => tagsByProject[projectId] ?? [],
    [tagsByProject],
  );

  const addTag = useCallback(
    (projectId: string, raw: string): boolean => {
      const tag = trimTag(raw.trim());
      if (!tag || !projectId) return false;
      let success = false;
      setTagsByProject((prev: ProjectTagsByProject) => {
        const existing = prev[projectId] ?? [];
        if (existing.includes(tag) || existing.length >= MAX_TAGS_PER_PROJECT) {
          return prev;
        }
        const next: ProjectTagsByProject = {
          ...prev,
          [projectId]: [...existing, tag],
        };
        writeAll(next);
        success = true;
        return next;
      });
      return success;
    },
    [],
  );

  const removeTag = useCallback((projectId: string, tag: string) => {
    setTagsByProject((prev: ProjectTagsByProject) => {
      const existing = prev[projectId];
      if (!existing) return prev;
      const next: ProjectTagsByProject = {
        ...prev,
        [projectId]: existing.filter((t) => t !== tag),
      };
      // 如果清空了,把空数组删掉,保持存储干净
      if (next[projectId]?.length === 0) {
        delete next[projectId];
      }
      writeAll(next);
      return next;
    });
  }, []);

  const setTags = useCallback((projectId: string, tags: string[]) => {
    const cleaned = Array.from(
      new Set(tags.map((t) => trimTag(t.trim())).filter((t) => t.length > 0)),
    ).slice(0, MAX_TAGS_PER_PROJECT);
    setTagsByProject((prev: ProjectTagsByProject) => {
      const next: ProjectTagsByProject = { ...prev };
      if (cleaned.length === 0) {
        delete next[projectId];
      } else {
        next[projectId] = cleaned;
      }
      writeAll(next);
      return next;
    });
  }, []);

  const hasTag = useCallback(
    (projectId: string, tag: string): boolean =>
      (tagsByProject[projectId] ?? []).includes(tag),
    [tagsByProject],
  );

  // 全局唯一 tag + 频次统计
  const tagCounts: Record<string, number> = {};
  for (const list of Object.values(tagsByProject) as string[][]) {
    for (const t of list) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }
  const allTags = Object.keys(tagCounts).sort(
    (a, b) => tagCounts[b]! - tagCounts[a]! || a.localeCompare(b),
  );

  return { tagsByProject, getTags, addTag, removeTag, setTags, hasTag, allTags, tagCounts };
}