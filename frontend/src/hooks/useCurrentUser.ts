/**
 * v2.0: 当前登录用户 hook
 *
 * 集中处理:
 *   - 进入页面拉一次 /auth/me
 *   - 监听 user 状态变化供 TopBar 等组件直接订阅
 *   - 提供 login() / logout() 辅助函数
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { CurrentUser } from '../types';

export interface UseCurrentUserResult {
  user: CurrentUser | null;
  authEnabled: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
}

export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getMe();
      setUser(res.user);
      setAuthEnabled(res.authEnabled);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 进入时拉取一次;authEnabled 默认 false 时不必再重试
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(() => {
    api.startLogin();
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
      setUser(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, []);

  return { user, authEnabled, loading, error, refresh, login, logout };
}