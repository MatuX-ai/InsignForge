/**
 * LLM 未配置时的引导弹窗 - 检测到 MISSING_API_KEY 时显示
 * 提供"前往设置"和"稍后再说"两个操作
 */
import { Modal } from './Modal';
import type { ErrorCode } from '../types';

interface Props {
  open: boolean;
  errorCode: ErrorCode | null;
  onClose: () => void;
  onGoSettings: () => void;
}

export function LlmSetupPrompt({ open, errorCode, onClose, onGoSettings }: Props) {
  if (!open || errorCode !== 'MISSING_API_KEY') return null;

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
        检测到当前大模型 Provider(<span className="font-medium">{providerHint()}</span>)
        尚未配置 API Key,无法生成调研报告。
      </p>
      <p className="text-helper text-text-secondary">
        点击「前往设置」填写 API Key 后,新调用将立即生效,无需重启服务。
        也可以在后端 <code className="px-1 bg-hover-bg rounded">.env</code> 中配置环境变量。
      </p>
    </Modal>
  );
}

/** 当前后端实际 provider 通过 settings/llm 查询会更精确,这里仅给出通用提示 */
function providerHint(): string {
  return 'LLM';
}