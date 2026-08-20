/**
 * Prompt: quick-research —— 快速调研 {idea}(quick 档)
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerQuickResearchPrompt(server: McpServer): void {
  server.prompt(
    'quick-research',
    '用 insightforge 的 quick 档快速调研产品想法。60 秒内出报告,适合在对话早期快速了解市场。',
    {
      idea: z
        .string()
        .min(3, 'idea 至少 3 个字符')
        .describe('要快速调研的产品想法,例如 "AI 会议纪要工具"'),
    },
    ({ idea }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `请使用 insightforge 的 market_research 工具对以下想法做 quick 档快速调研:\n\n` +
              `想法:${idea}\n\n` +
              `只关注三件事:\n` +
              `1. 市场热度评分(0-100), 是否值得继续做\n` +
              `2. 主要竞品(最多 3 个)\n` +
              `3. 一句话结论: 看起来有机会 / 看起来红海 / 证据不足`,
          },
        },
      ],
    }),
  );
}