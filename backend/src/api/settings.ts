/**
 * 设置路由 - /api/v1/settings
 *
 * GET   /llm                查询 LLM 配置状态(不返回 key 明文)
 * PUT   /llm/config         切换 provider / model(立即生效)
 * PUT   /llm/api-key        更新 LLM API Key(写入运行期 + 持久化 .env)
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from './response.js';
import {
  getLlmStatus,
  setLlmApiKey,
  setLlmConfig,
  setSearchConfig,
  type LlmProvider,
  type SearchProvider,
} from '../services/SettingsService.js';

export const settingsRouter = Router();

/** 查询 LLM 配置 */
settingsRouter.get(
  '/llm',
  asyncHandler((_req, res) => {
    return ok(res, getLlmStatus());
  })
);

/** 切换 provider / model */
const configSchema = z.object({
  provider: z.enum(['deepseek', 'openai', 'ollama']),
  model: z.string().min(1, 'Model 不能为空').max(100),
});

settingsRouter.put(
  '/llm/config',
  asyncHandler<{ body: unknown }>((req, res) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return ok(res, { ok: false, message: parsed.error.message });
    }
    setLlmConfig(parsed.data.provider as LlmProvider, parsed.data.model);
    return ok(res, { ok: true }, '已切换,新调用将立即生效');
  })
);

const updateKeySchema = z.object({
  apiKey: z.string().min(1, 'API Key 不能为空').max(500),
});

/** 更新 LLM API Key(写入当前 provider 的运行时 + .env) */
settingsRouter.put(
  '/llm/api-key',
  asyncHandler<{ body: unknown }>((req, res) => {
    const parsed = updateKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return ok(res, { ok: false, message: parsed.error.message });
    }
    setLlmApiKey(parsed.data.apiKey);
    return ok(res, { ok: true }, 'API Key 已更新,新调用将立即生效');
  })
);

/** 更新搜索引擎配置请求 */
const searchConfigSchema = z.object({
  provider: z.enum(['openserp', 'serpapi']).optional(),
  apiKey: z.string().max(500).optional(),
});

/** 更新搜索引擎配置(provider / SerpAPI Key,立即生效并持久化到 .env) */
settingsRouter.put(
  '/search',
  asyncHandler<{ body: unknown }>((req, res) => {
    const parsed = searchConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return ok(res, { ok: false, message: parsed.error.message });
    }
    setSearchConfig({
      provider: parsed.data.provider as SearchProvider | undefined,
      apiKey: parsed.data.apiKey,
    });
    return ok(res, { ok: true }, '搜索配置已更新,新调研将立即生效');
  })
);
