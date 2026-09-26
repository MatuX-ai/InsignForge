/**
 * v1.8 P8-A: 讨论画布分组折叠状态持久化
 *
 * 用户可折叠/展开 Discussion 画布的分组,
 * 状态按 session 隔离 + localStorage 持久化,刷新后保留。
 *
 * 设计:
 *   - 存储键 insightforge:discuss-collapsed:v1
 *   - 结构:{ [sessionId]: { [groupId]: true } }
 *   - 仅记录"折叠"的 groupId;展开的 group 不写,保持存储紧凑
 *   - 损坏的 JSON 不抛错,回退到空对象
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'insightforge:discuss-collapsed:v1';

export type CollapsedBySession = Record<string, Record<string, true>>;

export interface UseDiscussCollapseApi {
  /** 当前 session 中"已折叠"的 groupId 集合 */
  collapsed: Set<string>;
  isCollapsed: (groupId: string) => boolean;
  toggleGroup: (groupId: string) => void;
  setCollapsed: (groupId: string, collapsed: boolean) => void;
  collapseAll: (groupIds: string[]) => void;
  expandAll: () => void;
  /** 给 UI 用的统计:总数 / 已折叠数 */
  totalCollapsed: number;
}

function readAll(): CollapsedBySession {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: CollapsedBySession = {};
    for (const [sessionId, groups] of Object.entries(parsed)) {
      if (groups && typeof groups === 'object' && !Array.isArray(groups)) {
        const sub: Record<string, true> = {};
        for (const [gid, flag] of Object.entries(groups as Record<string, unknown>)) {
          if (flag === true) sub[gid] = true;
        }
        if (Object.keys(sub).length > 0) out[sessionId] = sub;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(map: CollapsedBySession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('[useDiscussCollapse] localStorage 写入失败:', err);
  }
}

export function useDiscussCollapse(sessionId: string | null): UseDiscussCollapseApi {
  const [bySession, setBySession] = useState<CollapsedBySession>({});

  useEffect(() => {
    setBySession(readAll());
  }, []);

  const collapsed = new Set<string>(
    sessionId ? Object.keys(bySession[sessionId] ?? {}) : [],
  );

  const isCollapsed = useCallback(
    (groupId: string): boolean => collapsed.has(groupId),
    // collapsed 是临时 Set,不应该作为依赖导致无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, bySession],
  );

  const writeUpdate = useCallback(
    (updater: (prev: CollapsedBySession) => CollapsedBySession) => {
      setBySession((prev: CollapsedBySession) => {
        const next = updater(prev);
        writeAll(next);
        return next;
      });
    },
    [],
  );

  const toggleGroup = useCallback(
    (groupId: string) => {
      if (!sessionId) return;
      writeUpdate((prev: CollapsedBySession) => {
        const sessionCollapsed = { ...(prev[sessionId] ?? {}) };
        if (sessionCollapsed[groupId]) {
          delete sessionCollapsed[groupId];
        } else {
          sessionCollapsed[groupId] = true;
        }
        const next: CollapsedBySession = { ...prev };
        if (Object.keys(sessionCollapsed).length === 0) {
          delete next[sessionId];
        } else {
          next[sessionId] = sessionCollapsed;
        }
        return next;
      });
    },
    [sessionId, writeUpdate],
  );

  const setCollapsed = useCallback(
    (groupId: string, wantCollapsed: boolean) => {
      if (!sessionId) return;
      const currentlyCollapsed = collapsed.has(groupId);
      if (currentlyCollapsed === wantCollapsed) return;
      toggleGroup(groupId);
    },
    // collapsed 是临时 Set,不应该作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, toggleGroup],
  );

  const collapseAll = useCallback(
    (groupIds: string[]) => {
      if (!sessionId || groupIds.length === 0) return;
      writeUpdate((prev: CollapsedBySession) => {
        const sessionCollapsed: Record<string, true> = {};
        for (const id of groupIds) sessionCollapsed[id] = true;
        return { ...prev, [sessionId]: sessionCollapsed };
      });
    },
    [sessionId, writeUpdate],
  );

  const expandAll = useCallback(() => {
    if (!sessionId) return;
    writeUpdate((prev: CollapsedBySession) => {
      if (!prev[sessionId]) return prev;
      const next: CollapsedBySession = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, [sessionId, writeUpdate]);

  return {
    collapsed,
    isCollapsed,
    toggleGroup,
    setCollapsed,
    collapseAll,
    expandAll,
    totalCollapsed: collapsed.size,
  };
}