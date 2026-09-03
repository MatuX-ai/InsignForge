/**
 * InsightForge 后端配置
 * 集中管理所有环境变量读取与默认值
 */
import 'dotenv/config';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_LLM_PROVIDER_IDS,
  getLlmProvider,
  type LlmProviderId,
} from './services/llm/providers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 环境变量校验 schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // LLM
  // 动态枚举,与 backend/src/services/llm/providers.ts 中 LLM_PROVIDERS 一致
  LLM_PROVIDER: z.enum(ALL_LLM_PROVIDER_IDS as [LlmProviderId, ...LlmProviderId[]]).default('deepseek'),
  // 默认回退模型:必须与 providers.ts 中 deepseek 的 defaultModel 保持一致,
  // 旧值 'deepseek-chat' 已于 2026-07-24 停用,改为当前 V4 旗舰 deepseek-v4-pro
  LLM_MODEL: z.string().default('deepseek-v4-pro'),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  // Ollama 本地模型地址(可选,也可写 OLLAMA_BASE_URL)
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  // 国产大模型 API Key(OpenAI 兼容协议)
  ZHIPU_API_KEY: z.string().optional(),
  QWEN_API_KEY: z.string().optional(),
  MOONSHOT_API_KEY: z.string().optional(),
  YI_API_KEY: z.string().optional(),
  // MiniMax MiniMax(M 系列)
  MINIMAX_API_KEY: z.string().optional(),
  // 腾讯混元
  HUNYUAN_API_KEY: z.string().optional(),
  // 商汤日日新
  SENSENOVA_API_KEY: z.string().optional(),
  // 阶跃星辰
  STEPFUN_API_KEY: z.string().optional(),

  // 搜索
  SEARCH_PROVIDER: z.enum(['openserp', 'serpapi']).default('openserp'),
  OPENSERP_URL: z.string().default('http://localhost:8080'),
  SERPAPI_KEY: z.string().optional(),

  // 数据库
  DATABASE_URL: z.string().default('../data/insightforge.db'),

  // 其他
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RESEARCH_TIMEOUT: z.coerce.number().default(300),
  // 历史文档自动归档目录(桌面模式由 main.cjs 注入,默认项目根/历史文档)
  HISTORY_DOC_DIR: z.string().optional(),
  // 讨论 AI 调研的 MCP 通道:配置启动命令(如 "npx -y @insightforge/mcp-server")后,
  // 讨论梳理中的营销调研将优先通过 MCP server 执行;未配置则回退到后端直连调研服务
  INSIGHTFORGE_MCP_COMMAND: z.string().optional(),

  // v2.0: OIDC / Casdoor 集成(双轨制;总开关关闭时所有接口行为与 v1.6 完全一致)
  INSIGHTFORGE_AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  INSIGHTFORGE_CASDOOR_ENDPOINT: z.string().optional(),
  INSIGHTFORGE_CASDOOR_CLIENT_ID: z.string().optional(),
  INSIGHTFORGE_CASDOOR_CLIENT_SECRET: z.string().optional(),
  INSIGHTFORGE_CASDOOR_REDIRECT_URI: z.string().optional(),
  INSIGHTFORGE_SESSION_SECRET: z.string().optional(),
  /**
   * 桌面端在 Window 中打开浏览器走 OAuth;强制 secure=false 以允许 httpOnly cookie
   * 在 http://localhost 下传输(浏览器桌面端默认是 file:// / 自定义 scheme,
   * express-session 对非 https 客户端的 secure 判断会拒绝 setCookie)。
   */
  INSIGHTFORGE_SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  console.error('环境变量校验失败:', parsedEnv.error.format());
  process.exit(1);
}

export const config = {
  ...parsedEnv.data,
  // 解析数据库绝对路径(相对于 backend/src/config.ts 的同级)
  DATABASE_PATH: path.resolve(__dirname, '..', parsedEnv.data.DATABASE_URL.replace(/^sqlite:/, '')),
  BACKEND_DIR: path.resolve(__dirname, '..'),
  PROJECT_ROOT: path.resolve(__dirname, '..', '..'),
  // 历史文档归档根目录(桌面模式 main.cjs 注入,开发模式回退到项目根/历史文档)
  HISTORY_DOC_DIR: parsedEnv.data.HISTORY_DOC_DIR
    ? path.resolve(parsedEnv.data.HISTORY_DOC_DIR)
    : path.resolve(__dirname, '..', '..', '历史文档'),
} as const;

// 派生计算 LLM API Key
// 使用 providers.ts 注册表统一管理;新增 provider 时只需在注册表中添加项即可
export function getLlmApiKey(): string {
  const meta = getLlmProvider(config.LLM_PROVIDER as LlmProviderId);
  if (!meta) return '';
  // Ollama 本地走 OLLAMA_BASE_URL,而非 _API_KEY,这里返回空
  if (meta.id === 'ollama') return '';
  const raw = (config as Record<string, unknown>)[meta.envKeyName];
  return typeof raw === 'string' ? raw : '';
}

export function getLlmBaseUrl(): string {
  const meta = getLlmProvider(config.LLM_PROVIDER as LlmProviderId);
  if (!meta) return 'https://api.openai.com/v1';
  // Ollama 允许通过 OLLAMA_BASE_URL 自定义(剥离末尾 /v1 让调用方按需拼接)
  if (meta.id === 'ollama') {
    return (config.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/v1\/?$/, '');
  }
  return meta.baseUrl;
}