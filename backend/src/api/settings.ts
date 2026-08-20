/**
 * 设置路由 - /api/v1/settings
 *
 * GET   /llm                查询 LLM 配置状态(不返回 key 明文)
 * PUT   /llm/api-key        更新 LLM API Key(写入运行期 + 持久化 .env)
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from './response.js';
import { getLlmStatus, setLlmApiKey } from '../services/SettingsService.js';

export const settingsRouter = Router();

/** 查询 LLM 配置 */
settingsRouter.get(
  '/llm',
  asyncHandler((_req, res) => {
    return ok(res, getLlmStatus());
  })
);

const updateKeySchema = z.object({
  apiKey: z.string().min(1, 'API Key 不能为空').max(500),
});

/** 更新 LLM API Key */
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