/**
 * 首次启动引导弹窗 - 检测到未配置 LLM API Key 时显示
 *
 * 行为:
 * - 应用启动时从后端查询 LLM 状态,未配置则弹窗
 * - 用户填写并保存后,自动关闭弹窗
 * - 用户点击"稍后再说"则记住选择,同机器不再弹出
 * - provider 为 ollama 时跳过(本地模型无需 key)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { LlmStatus } from '../types';

interface Props {
  onConfigured: () => void;
}

export function OnboardingModal({ onConfigured }: Props) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useLocalStorage('llm_setup_dismissed', false);

  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // 表单状态
  const [provider, setProvider] = useState<'deepseek' | 'openai' | 'ollama'>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 启动时查询后端 LLM 状态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getLlmStatus();
        if (cancelled) return;
        setLlmStatus(s);
        // ollama 不需要 key,跳过引导
        if (s.provider === 'ollama') {
          setLoading(false);
          return;
        }
        // 已配置 key 或用户之前点过"稍后再说",不弹
        if (s.hasApiKey || dismissed) {
          setLoading(false);
          return;
        }
        // 首次使用,未配置 key → 弹出引导
        setShowModal(true);
        setProvider(s.provider as 'deepseek' | 'openai' | 'ollama');
      } catch {
        // 后端查询失败静默跳过,不影响主流程
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('API Key 不能为空');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await api.updateLlmApiKey(trimmed);
      if (!res.ok) throw new Error(res.message ?? '保存失败');
      setDismissed(true);
      setShowModal(false);
      onConfigured();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setShowModal(false);
  };

  const handleGoSettings = () => {
    setDismissed(true);
    setShowModal(false);
    navigate('/settings');
  };

  if (loading) return null;
  if (!showModal || !llmStatus) return null;

  const baseUrlHint =
    provider === 'deepseek'
      ? 'https://platform.deepseek.com/api_keys'
      : provider === 'openai'
        ? 'https://platform.openai.com/api-keys'
        : '';

  return (
    <Modal
      open={showModal}
      onClose={handleDismiss}
      title="首次启动 · 配置大模型"
      tone="primary"
      primaryLabel={saving ? '保存中...' : '保存并开始'}
      onPrimary={handleSave}
      secondaryLabel="稍后再说"
      onSecondary={handleDismiss}
      maskClosable={false}
    >
      <p className="text-body text-text-secondary">
        InsightForge 需要调用大模型来生成市场报告,请先配置 API Key。
      </p>

      {/* Provider 选择 */}
      <div className="mt-4">
        <label className="text-helper text-text-secondary block mb-1">大模型</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as typeof provider)}
          className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        >
          <option value="deepseek">DeepSeek (推荐)</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama (本地)</option>
        </select>
      </div>

      {/* API Key 输入 */}
      <div className="mt-4">
        <label className="text-helper text-text-secondary block mb-1">
          API Key
          {baseUrlHint && (
            <a
              href={baseUrlHint}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              去获取 →
            </a>
          )}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="sk-..."
          autoFocus
          className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        />
        {error && <p className="text-helper text-red-400 mt-1">{error}</p>}
        <p className="text-helper text-text-secondary mt-1">
          密钥仅在本地使用,不会上传到任何第三方服务
        </p>
      </div>

      <p className="text-helper text-text-secondary mt-3">
        也可以点击「稍后再说」,之后在设置页手动配置。
      </p>
    </Modal>
  );
}
