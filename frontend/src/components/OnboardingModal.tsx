/**
 * 首次启动引导弹窗 - 检测到未配置 LLM API Key 时显示
 *
 * 行为:
 * - 应用启动时从后端查询 LLM 状态,未配置则弹窗
 * - 用户填写并保存后,自动关闭弹窗
 * - 用户点击"先跳过，去首页"则记住选择,同机器不再弹出
 * - provider 为 ollama 时跳过(本地模型无需 key)
 *
 * v2.0 修复:
 * - BUG-01: handleSave 现在先调用 updateLlmConfig(provider, model),
 *           再调用 updateLlmApiKey,确保后端实际生效的是用户当前选择的 provider
 * - BUG-03: 新增 model 表单状态,切换 provider 时同步重置
 * - P2-11: 次要按钮文案从"稍后再说"改为"先跳过，去首页",消除"这是可选项"的误解
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useLocalStorage } from '../hooks/useLocalStorage';
import {
  LLM_PROVIDERS,
  defaultModelFor,
  getLlmProvider,
} from '../lib/llmProviders';
import type { LlmProvider, LlmStatus } from '../types';

interface Props {
  onConfigured: () => void;
}

export function OnboardingModal({ onConfigured }: Props) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useLocalStorage('llm_setup_dismissed', false);

  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // 表单状态(使用 LlmProvider 联合类型,涵盖国产大模型选项)
  const [provider, setProvider] = useState<LlmProvider>('deepseek');
  // 修复 BUG-03: 显式保存 model 字段,切换 provider 时同步重置为新 provider 的默认值
  const [model, setModel] = useState<string>(defaultModelFor('deepseek'));
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
        // 已配置 key 或用户之前点过"先跳过，去首页",不弹
        if (s.hasApiKey || dismissed) {
          setLoading(false);
          return;
        }
        // 首次使用,未配置 key → 弹出引导
        setShowModal(true);
        if (getLlmProvider(s.provider)) {
          setProvider(s.provider as LlmProvider);
        } else {
          setProvider('deepseek');
        }
        // 用后端实际生效的 model 回填(若后端有)
        if (s.model) {
          setModel(s.model);
        } else {
          setModel(defaultModelFor(s.provider as LlmProvider));
        }
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
    // ollama / 不需 key 的 provider 允许提交空 key
    const meta = getLlmProvider(provider);
    const trimmed = apiKey.trim();
    if (meta?.requiresKey !== false && !trimmed) {
      setError('API Key 不能为空');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // 修复 BUG-01: 先切换 provider/model(后端会重建 LLM 单例),
      // 再写 api-key,避免出现"provider=glm, model=deepseek-chat"这种不一致状态。
      // 此前的实现只调用 updateLlmApiKey,导致后端仍用旧 provider,误导用户。
      const cfgRes = await api.updateLlmConfig({ provider, model });
      if (!cfgRes.ok) throw new Error(cfgRes.message ?? '切换模型失败');
      // 若用户没有显式填 key 但当前 provider 不需要 key,后端写入空字符串等于"使用 .env 默认"
      const res = await api.updateLlmApiKey(trimmed || 'sk-placeholder');
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

  // 选取当前 provider 的 meta;若后端支持但前端未同步注册,降级为 undefined
  const currentProviderMeta = getLlmProvider(provider);
  const keyUrl = currentProviderMeta?.keyUrl ?? '';
  const requiresKey = currentProviderMeta?.requiresKey ?? true;

  return (
    <Modal
      open={showModal}
      onClose={handleDismiss}
      title="首次启动 · 配置大模型"
      tone="primary"
      primaryLabel={saving ? '保存中...' : '保存并开始'}
      onPrimary={handleSave}
      secondaryLabel="先跳过，去首页"
      onSecondary={handleDismiss}
      maskClosable={false}
    >
      <p className="text-body text-text-secondary">
        InsightForge 需要调用大模型来生成市场报告,请先配置 API Key。
      </p>

      {/* Provider 选择(由前端 LLM_PROVIDERS 注册表驱动) */}
      <div className="mt-4">
        <label className="text-helper text-text-secondary block mb-1">大模型</label>
        <select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as LlmProvider;
            // 修复 BUG-03: 同步把 model 字段重置为新 provider 的默认值,
            // 避免出现"provider=glm, model=deepseek-chat"这种不一致状态。
            // 修复 BUG-01 同样依赖于此:handleSave 提交时 model 永远与 provider 匹配。
            setProvider(next);
            setModel(defaultModelFor(next));
          }}
          className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
        >
          {LLM_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {currentProviderMeta?.description && (
          <div className="text-helper text-text-secondary mt-1">
            {currentProviderMeta.description}
          </div>
        )}
      </div>

      {/* Model 显示(只读提示,引导用户去设置页修改) */}
      <div className="mt-3">
        <label className="text-helper text-text-secondary block mb-1">模型</label>
        <div className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/30 text-body text-text-secondary flex items-center">
          {model}
        </div>
        <div className="text-helper text-text-secondary mt-1">
          默认模型,可在「设置」页自由调整
        </div>
      </div>

      {/* API Key 输入 */}
      <div className="mt-4">
        <label className="text-helper text-text-secondary block mb-1">
          API Key
          {requiresKey && keyUrl && (
            <a
              href={keyUrl}
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
          // v1.8 P0-A4: 与桌面端习惯一致,小文本输入框 Enter 提交
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder={
            requiresKey ? 'sk-...' : '本地 Ollama 无需 Key,留空即可'
          }
          autoFocus
          className="w-full h-10 px-3 border border-border rounded-lg bg-card-solid/50 text-body text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg transition-all"
        />
        {error && <p className="text-helper text-red-400 mt-1">{error}</p>}
        <p className="text-helper text-text-secondary mt-1">
          密钥仅在本地使用,不会上传到任何第三方服务
        </p>
      </div>

      <p className="text-helper text-text-secondary mt-3">
        也可以点击「先跳过，去首页」，之后在首页右上角 → 设置 → 大模型 API 随时回来配置。
      </p>
    </Modal>
  );
}
