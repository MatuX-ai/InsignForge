/**
 * 设置服务 - 管理 LLM/搜索等可热更新的运行时配置
 *
 * 当前能力:
 * - 查询 LLM 配置状态(provider/model/是否已配置 key,key 永不出网)
 * - 更新 LLM API Key:写入内存(立即生效)+ 持久化到后端 .env(重启后保留)
 *
 * 注:本服务对个人版 MVP 已足够,多用户场景下应改为按 user_id 存储
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, getLlmApiKey } from '../config.js';
import { logger } from '../logger.js';
import { resetLlmClient } from './llm/LLMClient.js';

export type LlmProvider = 'deepseek' | 'openai' | 'ollama';

/**
 * 当前进程内可被覆盖的 LLM Key(运行期优先于 .env)
 * 仅记录当前 provider 对应的 key,切换 provider 时会丢弃
 */
let runtimeApiKey: string | null = null;

/**
 * 解析当前生效的 LLM API Key
 * 优先返回运行期覆盖值,其次回退到 .env 加载的 config
 */
export function resolveLlmApiKey(): string {
  if (runtimeApiKey && runtimeApiKey.trim().length > 0) return runtimeApiKey;
  return getLlmApiKey();
}

/**
 * 取得 .env 文件绝对路径
 * 优先使用后端目录下的 .env,其次回退到项目根目录
 */
function resolveEnvPath(): string {
  const backendEnv = path.resolve(config.BACKEND_DIR, '.env');
  if (fs.existsSync(backendEnv)) return backendEnv;
  const rootEnv = path.resolve(config.PROJECT_ROOT, '.env');
  return rootEnv;
}

/**
 * 读取 .env 文件并更新或新增指定变量
 * 保持现有行顺序,值使用双引号包裹(支持空格的兼容)
 */
function updateEnvFile(envPath: string, key: string, value: string): void {
  const normalized = value.replace(/\r?\n/g, '');
  const line = `${key}="${normalized}"`;

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  const lines = content.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((l) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && m[1] === key) {
      replaced = true;
      return line;
    }
    return l;
  });

  if (!replaced) next.push(line);

  fs.writeFileSync(envPath, next.join('\n'), 'utf8');
}

/**
 * 查询当前 LLM 配置状态(key 仅返回是否存在,不返回明文)
 */
export function getLlmStatus(): {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  runtimeOverride: boolean;
} {
  const hasApiKey = resolveLlmApiKey().length > 0;
  return {
    provider: config.LLM_PROVIDER as LlmProvider,
    model: config.LLM_MODEL,
    baseUrl: resolveBaseUrl(),
    hasApiKey: config.LLM_PROVIDER === 'ollama' ? true : hasApiKey,
    runtimeOverride: runtimeApiKey !== null,
  };
}

function resolveBaseUrl(): string {
  if (config.LLM_PROVIDER === 'ollama') return config.OLLAMA_BASE_URL;
  if (config.LLM_PROVIDER === 'deepseek') return 'https://api.deepseek.com';
  return 'https://api.openai.com';
}

/**
 * 更新 LLM API Key
 * - 写入运行期缓存,重置 LLM 单例,下次调用立即生效
 * - 异步落盘到 .env(失败仅记录日志,不抛错)
 */
export function setLlmApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  runtimeApiKey = trimmed.length > 0 ? trimmed : null;

  // 重置 LLM 单例,让下一次 chatComplete 拿到新 key
  resetLlmClient();

  // 持久化到 .env(失败不影响运行期)
  try {
    const envKey = `${config.LLM_PROVIDER.toUpperCase()}_API_KEY`;
    const envPath = resolveEnvPath();
    updateEnvFile(envPath, envKey, trimmed);
    // 同时更新进程 env,避免某些代码路径直接读 process.env
    process.env[envKey] = trimmed;
    logger.info({ provider: config.LLM_PROVIDER, envPath }, 'LLM API Key 已更新');
  } catch (err) {
    logger.error({ err }, '持久化 LLM API Key 到 .env 失败,仅运行期生效');
  }
}

/**
 * 清除运行期 key(回退到 .env)
 */
export function clearRuntimeApiKey(): void {
  runtimeApiKey = null;
  resetLlmClient();
}