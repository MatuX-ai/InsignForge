/**
 * InsightForge 后端配置
 * 集中管理所有环境变量读取与默认值
 */
import 'dotenv/config';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 环境变量校验 schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // LLM
  LLM_PROVIDER: z.enum(['deepseek', 'openai', 'ollama']).default('deepseek'),
  LLM_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),

  // 搜索
  SEARCH_PROVIDER: z.enum(['openserp', 'serpapi']).default('openserp'),
  OPENSERP_URL: z.string().default('http://localhost:8080'),
  SERPAPI_KEY: z.string().optional(),

  // 数据库
  DATABASE_URL: z.string().default('../data/insightforge.db'),

  // 其他
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RESEARCH_TIMEOUT: z.coerce.number().default(300),
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
} as const;

// 派生计算 LLM API Key
export function getLlmApiKey(): string {
  switch (config.LLM_PROVIDER) {
    case 'deepseek':
      return config.DEEPSEEK_API_KEY ?? '';
    case 'openai':
      return config.OPENAI_API_KEY ?? '';
    case 'ollama':
      return ''; // Ollama 通常无需 key
    default:
      return '';
  }
}

export function getLlmBaseUrl(): string {
  if (config.LLM_PROVIDER === 'ollama') return config.OLLAMA_BASE_URL;
  if (config.LLM_PROVIDER === 'deepseek') return 'https://api.deepseek.com';
  if (config.LLM_PROVIDER === 'openai') return 'https://api.openai.com';
  return 'https://api.openai.com';
}