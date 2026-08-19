/**
 * localStorage 通用 Hook
 * 自动处理 SSR 不安全、JSON 序列化、反序列化失败回退
 */
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  // 首次挂载时从 localStorage 读取
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        setValue(JSON.parse(stored) as T);
      }
    } catch {
      // 忽略解析错误
    }
    setHydrated(true);
  }, [key]);

  // 值变化时持久化
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 忽略写入错误(如 quota exceeded)
    }
  }, [key, value, hydrated]);

  return [value, setValue];
}