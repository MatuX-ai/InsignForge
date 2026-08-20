/**
 * 调研 Hook - 封装"触发调研 + 轮询状态 + 获取报告"全流程
 * 前端设计文档 §6.2 明确使用简单轮询(每 3 秒),不用 WebSocket
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
  trigger: (projectId: string) => Promise<void>;
  reset: () => void;
}

const POLL_INTERVAL = 3000; // 3s,按前端设计文档 §6.2

export function useResearch(): UseResearchReturn {
  const [status, setStatus] = useState<ResearchStatus | null>(null);
  const [report, setReport] = useState<MarketReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
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
        setError('调研失败,请重试');
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

  const trigger = useCallback(
    async (projectId: string) => {
      try {
        reset();
        setLoading(true);
        projectIdRef.current = projectId;
        await api.triggerResearch(projectId);
        // 立即拉一次,然后开始轮询
        await poll();
        timerRef.current = window.setInterval(poll, POLL_INTERVAL);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setErrorCode(null);
        setLoading(false);
      }
    },
    [poll, reset]
  );

  // 卸载时清理
  useEffect(() => stop, [stop]);

  return { status, report, loading, error, errorCode, trigger, reset };
}