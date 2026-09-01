/**
 * 调研 Hook - 封装"触发调研 + 轮询状态 + 获取报告"全流程
 * 前端设计文档 §6.2 明确使用简单轮询(每 3 秒),不用 WebSocket
 *
 * 错误恢复策略:
 *   - triggerResearch 瞬时失败自动重试 3 次(1s/2s/4s 指数退避)
 *   - 用户也可通过 UI 的"重试"按钮手动触发
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import type { MarketReport, ResearchStatus, ErrorCode } from '../types';

interface UseResearchReturn {
  status: ResearchStatus | null;
  report: MarketReport | null;
  loading: boolean;
  error: string | null;
  /** 业务错误码(如 MISSING_API_KEY),与 error 同步出现 */
  errorCode: ErrorCode | null;
  /** 当前自动重试的尝试次数(0 = 未在重试) */
  retryAttempt: number;
  trigger: (projectId: string) => Promise<void>;
  /** 手动重试 - 用最近一次的 projectId */
  retry: () => Promise<void>;
  reset: () => void;
}

const POLL_INTERVAL = 3000; // 3s,按前端设计文档 §6.2
const MAX_AUTO_RETRIES = 3;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function useResearch(): UseResearchReturn {
  const [status, setStatus] = useState<ResearchStatus | null>(null);
  const [report, setReport] = useState<MarketReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const projectIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stop();
    setStatus(null);
    setReport(null);
    setError(null);
    setErrorCode(null);
    setLoading(false);
    setRetryAttempt(0);
    projectIdRef.current = null;
  }, [stop]);

  const poll = useCallback(async () => {
    const projectId = projectIdRef.current;
    if (!projectId) return;
    try {
      const s = await api.getStatus(projectId);
      setStatus(s);
      if (s.execution.status === 'success') {
        // 调研完成,加载报告
        const r = await api.getReport(projectId);
        setReport(r);
        stop();
        setLoading(false);
      } else if (s.execution.status === 'failed') {
        setErrorCode(s.execution.error_code ?? 'INTERNAL_ERROR');
        // 优先使用后端返回的 progress(原本就是 ProjectService.updateStatus 写入的 message);
        // 保留 detail 让 explainError 拿到原始错误,避免只看到 “调研失败,请重试”
        setError(s.progress || '调研失败,请重试');
        stop();
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorCode(null);
      stop();
      setLoading(false);
    }
  }, [stop]);

  /**
   * 触发调研,内部对网络瞬时错误做指数退避自动重试。
   * 业务错误(MISSING_API_KEY 等)由后端抛出且不会恢复,不重试。
   */
  const trigger = useCallback(
    async (projectId: string) => {
      reset();
      setLoading(true);
      projectIdRef.current = projectId;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
        if (attempt > 0) {
          setRetryAttempt(attempt);
          // 指数退避 1s / 2s / 4s
          await sleep(1000 * Math.pow(2, attempt - 1));
        }
        try {
          await api.triggerResearch(projectId);
          setRetryAttempt(0);
          // 立即拉一次,然后开始轮询
          await poll();
          timerRef.current = window.setInterval(poll, POLL_INTERVAL);
          return;
        } catch (err) {
          lastErr = err;
          // 后端业务错误不重试
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes('MISSING_API_KEY') ||
            msg.includes('API Key') ||
            msg.includes('LLM')
          ) {
            setError(msg);
            setErrorCode(null);
            setLoading(false);
            setRetryAttempt(0);
            return;
          }
        }
      }
      // 全部失败
      setError(lastErr instanceof Error ? lastErr.message : String(lastErr));
      setErrorCode(null);
      setLoading(false);
      setRetryAttempt(0);
    },
    [poll, reset]
  );

  /** 手动重试 - 用最近一次的 projectId */
  const retry = useCallback(async () => {
    const pid = projectIdRef.current;
    if (pid === null) return;
    await trigger(pid);
  }, [trigger]);

  // 卸载时清理
  useEffect(() => stop, [stop]);

  return {
    status,
    report,
    loading,
    error,
    errorCode,
    retryAttempt,
    trigger,
    retry,
    reset,
  };
}