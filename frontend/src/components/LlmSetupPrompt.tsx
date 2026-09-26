/**
 * LLM 未配置时的引导弹窗 - 检测到 MISSING_API_KEY 时显示
 * 提供"前往设置"和"稍后再说"两个操作
 *
 * v2.0 修复 (BUG-02):
 *   不再硬编码返回 'LLM',而是通过 props 接收当前真实 provider 名,
 *   让用户明确知道是哪一个 Provider 没配 Key(DeepSeek? 智谱 GLM?)
 */
import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { getLlmProvider } from '../lib/llmProviders';
import type { ErrorCode, LlmStatus } from '../types';

interface Props {
  open: boolean;
  errorCode: ErrorCode | null;
  onClose: () => void;
  onGoSettings: () => void;
}

export function LlmSetupPrompt({ open, errorCode, onClose, onGoSettings }: Props) {
  const [status, setStatus] = useState<LlmStatus | null>(null);

  // 弹窗打开时主动查询一次后端 LLM 状态,获取真实 provider 名
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getLlmStatus();
        if (!cancelled) setStatus(s);
      } catch {
        // 后端不可达时降级到默认文案
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || errorCode !== 'MISSING_API_KEY') return null;

  // 修复 BUG-02: 用真实 provider 名(优先用 LLM_PROVIDERS 注册表的 label),
  // 不再硬编码 'LLM'。若后端返回未知 provider id,降级为 raw id。
  const providerHint = (() => {
    const raw = status?.provider ?? '';
    if (!raw) return '当前大模型';
    const meta = getLlmProvider(raw);
    return meta?.label ?? raw;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="未配置大模型 API Key"
      tone="warning"
      primaryLabel="前往设置"
      onPrimary={onGoSettings}
      secondaryLabel="稍后再说"
    >
      <p>
        检测到当前大模型 Provider(<span className="font-medium">{providerHint}</span>)
        尚未配置 API Key,无法生成调研报告。
      </p>
      <p className="text-helper text-text-secondary">
        点击「前往设置」填写 API Key 后,新调用将立即生效,无需重启服务。
        也可以在后端 <code className="px-1 bg-hover-bg rounded text-primary-light">.env</code> 中配置环境变量。
      </p>
    </Modal>
  );
}
