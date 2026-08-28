/**
 * 设置服务 - 管理 LLM/搜索等可热更新的运行时配置
 *
 * 当前能力:
 * - 运行时切换 provider / model(立即生效,无需重启)
 * - 每个 provider 独立保存 API Key(切换 provider 时各 key 不丢失)
 * - 持久化到 .env(重启后保留)
 *
 * 注:本服务对个人版 MVP 已足够,多用户场景下应改为按 user_id 存储
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, getLlmBaseUrl } from '../config.js';
import { logger } from '../logger.js';
import { resetLlmClient } from './llm/LLMClient.js';
import {
  getLlmProvider,
  defaultModelFor,
  type LlmProviderId,
} from './llm/providers.js';

/**
 * 重新导出 LlmProvider 类型别名,保持对外 API 不变
 * 实际定义在 ./llm/providers.ts (统一注册表)
 */
export type LlmProvider = LlmProviderId;
export type SearchProvider = 'openserp' | 'serpapi';

/**
 * 运行时覆盖(优先于 .env 加载的 config)
 *
 * - runtimeProvider: 切换后立即生效
 * - runtimeModel:    切换后立即生效
 * - runtimeApiKeys:  按 provider 存各自的 key,切换 provider 时各 key 不丢失
 */
let runtimeProvider: LlmProvider | null = null;
let runtimeModel: string | null = null;
/** 记录已设置过的 provider key,用于 providerKeyMap 合并计算 */
const runtimeApiKeys: Partial<Record<LlmProvider, string>> = {};

// ---- 搜索运行时覆盖(设置页可热更新,无需重启) ----
let runtimeSearchProvider: SearchProvider | null = null;
let runtimeSerpApiKey: string | null = null;

/** 当前生效的搜索引擎 provider(运行时覆盖优先,回退到 .env 加载的 config) */
export function getSearchProvider(): SearchProvider {
  return runtimeSearchProvider ?? (config.SEARCH_PROVIDER as SearchProvider);
}

/** 当前生效的 SerpAPI Key(运行时覆盖优先,回退到 .env) */
export function getSearchApiKey(): string {
  if (runtimeSerpApiKey !== null) return runtimeSerpApiKey;
  return config.SERPAPI_KEY ?? '';
}

/**
 * 更新搜索配置(设置页调用,立即生效并持久化到 .env)
 * - provider: 切换搜索引擎(可选)
 * - apiKey:   SerpAPI Key(空字符串视为清空)
 */
export function setSearchConfig(input: { provider?: SearchProvider; apiKey?: string }): void {
  if (input.provider) {
    runtimeSearchProvider = input.provider;
    persistEnv('SEARCH_PROVIDER', input.provider);
    process.env.SEARCH_PROVIDER = input.provider;
  }
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    runtimeSerpApiKey = trimmed.length > 0 ? trimmed : null;
    persistEnv('SERPAPI_KEY', trimmed);
    process.env.SERPAPI_KEY = trimmed;
  }
  logger.info(
    { provider: getSearchProvider(), hasSerpApiKey: (getSearchApiKey() ?? '').length > 0 },
    '搜索配置已更新'
  );
}

/**
 * 当前生效的 provider(运行时覆盖优先,回退到 .env 加载的 config)
 */
export function getCurrentProvider(): LlmProvider {
  return (runtimeProvider ?? (config.LLM_PROVIDER as LlmProvider)) as LlmProvider;
}

/**
 * 当前生效的 model(运行时覆盖优先,回退到 .env 加载的 config)
 */
export function getCurrentModel(): string {
  return runtimeModel ?? config.LLM_MODEL;
}

/**
 * 当前生效 provider 的 API Key
 * 优先 runtimeApiKeys,再回退到 .env 加载的 config
 */
export function resolveLlmApiKey(): string {
  const provider = getCurrentProvider();
  const runtimeKey = runtimeApiKeys[provider];
  if (runtimeKey && runtimeKey.trim().length > 0) return runtimeKey;
  return configKeyFor(provider);
}

/** 从 .env 加载的 config 中读取指定 provider 的 key */
function configKeyFor(provider: LlmProvider): string {
  const meta = getLlmProvider(provider);
  if (!meta) return '';
  // Ollama / 无需 key 的 provider 返回空
  if (!meta.requiresKey) return '';
  const raw = (config as unknown as Record<string, unknown>)[meta.envKeyName];
  return typeof raw === 'string' ? (raw as string) : '';
}

/**
 * 取得 .env 文件绝对路径
 * 桌面模式由宿主进程设置 DOTENV_CONFIG_PATH(用户数据目录),优先使用;
 * 否则按后端目录 → 项目根目录回退
 */
function resolveEnvPath(): string {
  const dotenvPath = process.env.DOTENV_CONFIG_PATH;
  if (dotenvPath) return path.resolve(dotenvPath);
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

/** 持久化单个环境变量到 .env(失败仅记录日志,不影响运行期) */
function persistEnv(key: string, value: string): void {
  try {
    updateEnvFile(resolveEnvPath(), key, value);
  } catch (err) {
    logger.error({ err, key }, `持久化 ${key} 到 .env 失败,仅运行期生效`);
  }
}

export interface LlmStatusInfo {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  runtimeOverride: boolean;
  /** 当前生效 provider 的 key 掩码(如 sk-****1234),用于设置页回显确认 */
  apiKeyMask: string;
  /** 各 provider 是否已配置 key(用于指示器展示状态) */
  providerKeyMap: Record<LlmProvider, boolean>;
}

/** 生成 API Key 掩码: 保留前 3 位与后 4 位,中间用 **** 代替 */
function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 4) return '****';
  return `${k.slice(0, 3)}****${k.slice(-4)}`;
}

/**
 * 查询当前 LLM 配置状态(key 仅返回掩码,不返回明文)
 *
 * providerKeyMap 的实现要点:
 * - 若 provider 元数据 requiresKey=false(如 ollama),固定为 true
 * - 否则看运行时覆盖 + .env 加载的 config,二者其一有非空 key 即视为"已配置"
 * - 这样设置页"Provider 配置状态"面板才能区分各家是否已备好凭证
 */
export function getLlmStatus(): LlmStatusInfo {
  const provider = getCurrentProvider();
  const model = getCurrentModel();
  const apiKey = resolveLlmApiKey();
  const meta = getLlmProvider(provider);
  // ollama / 不需 key 的 provider 一律视为 hasApiKey=true
  const hasApiKey = meta && !meta.requiresKey ? true : apiKey.length > 0;

  // 构建 providerKeyMap:取注册表中所有 provider 元数据,逐个探测 .env 是否有 key
  // 或运行时是否已经覆盖过;为兼容现有 providerKeyMap 类型(已收紧为 LlmProviderId 联合)
  // 这里按需构造满足严格联合的对象。
  const providerKeyMap = {} as Record<LlmProvider, boolean>;
  for (const p of [
    'deepseek',
    'openai',
    'ollama',
    'zhipu',
    'qwen',
    'moonshot',
    'yi',
    'MiniMax',
    'hunyuan',
    'sensenova',
    'stepfun',
  ] as LlmProvider[]) {
    const m = getLlmProvider(p);
    if (!m) {
      providerKeyMap[p] = false;
      continue;
    }
    if (!m.requiresKey) {
      providerKeyMap[p] = true; // 本地/无需 key 视为已配置
      continue;
    }
    const envKey = configKeyFor(p);
    providerKeyMap[p] = envKey.length > 0 || !!runtimeApiKeys[p];
  }

  return {
    provider,
    model,
    baseUrl: resolveBaseUrl(),
    hasApiKey,
    runtimeOverride: runtimeProvider !== null || runtimeModel !== null,
    apiKeyMask: hasApiKey && meta?.requiresKey ? maskKey(apiKey) : '',
    providerKeyMap,
  };
}

function resolveBaseUrl(): string {
  // 复用 config.getLlmBaseUrl 的逻辑,避免在后端逻辑链上重复
  return getLlmBaseUrl();
}

/**
 * 切换 provider / model(运行时立即生效)
 * - 不修改其他 provider 的 key
 * - 持久化 LLM_PROVIDER / LLM_MODEL 到 .env
 * - 若新 provider 没有同名 model,自动采用该 provider 注册表中的默认 model
 */
export function setLlmConfig(provider: LlmProvider, model: string): void {
  const prevProvider = getCurrentProvider();
  runtimeProvider = provider;
  // 切换 provider 时:若 user 传的 model 为空,使用该 provider 的默认 model
  const trimmed = model.trim();
  runtimeModel = trimmed.length > 0 ? trimmed : defaultModelFor(provider);

  // 重建客户端单例
  resetLlmClient();

  // 持久化到 .env
  try {
    const envPath = resolveEnvPath();
    updateEnvFile(envPath, 'LLM_PROVIDER', provider);
    updateEnvFile(envPath, 'LLM_MODEL', runtimeModel);
    // 同步到 process.env,供 config.ts 重新解析(可选,此处仅保持运行时)
    process.env.LLM_PROVIDER = provider;
    process.env.LLM_MODEL = runtimeModel;
    logger.info(
      { provider, model: runtimeModel, prevProvider },
      'LLM 配置已切换'
    );
  } catch (err) {
    logger.error({ err }, '持久化 LLM 配置到 .env 失败,仅运行期生效');
  }
}

/**
 * 更新当前 provider 的 API Key
 * - 写入 runtimeApiKeys(provider 维度),立即生效
 * - 持久化到 .env(失败仅记录日志,不抛错)
 *
 * 切换 provider 后,调用本函数只会更新新 provider 的 key,旧 provider 的 key 保留
 *
 * envKey:对应 provider 元数据 envKeyName(如 DEEPSEEK_API_KEY),
 *        ollama 在这里写 OLLAMA_BASE_URL 以允许用户从设置页修改本地服务地址
 */
export function setLlmApiKey(apiKey: string): void {
  const provider = getCurrentProvider();
  const meta = getLlmProvider(provider);
  const trimmed = apiKey.trim();

  if (meta && !meta.requiresKey) {
    // ollama: apiKey 字段实际存放 baseUrl,不持久化到 OLLAMA_BASE_URL
    // 这里仅校验,不动 .env(baseUrl 单独走 process.env / OLLAMA_BASE_URL)
    if (trimmed.length > 0) {
      logger.warn(
        { provider },
        `${provider} 不需要 API Key,该字段将被忽略(baseUrl 请直接修改 OLLAMA_BASE_URL 环境变量)`
      );
    }
    return;
  }

  if (trimmed.length > 0) {
    runtimeApiKeys[provider] = trimmed;
  } else {
    // 空字符串视为清空当前 provider 的运行期覆盖,回退到 .env
    delete runtimeApiKeys[provider];
  }

  // 重置 LLM 单例,让下一次 chatComplete 拿到新 key
  resetLlmClient();

  // 持久化到 .env(失败不影响运行期)
  try {
    if (!meta) return;
    const envKey = meta.envKeyName;
    const envPath = resolveEnvPath();
    updateEnvFile(envPath, envKey, trimmed);
    // 同时更新进程 env,避免某些代码路径直接读 process.env
    process.env[envKey] = trimmed;
    logger.info({ provider, envPath }, 'LLM API Key 已更新');
  } catch (err) {
    logger.error({ err }, '持久化 LLM API Key 到 .env 失败,仅运行期生效');
  }
}

/**
 * 清除所有运行期覆盖(回退到 .env)
 */
export function clearRuntimeConfig(): void {
  runtimeProvider = null;
  runtimeModel = null;
  Object.keys(runtimeApiKeys).forEach((k) => {
    delete runtimeApiKeys[k as LlmProvider];
  });
  resetLlmClient();
}
