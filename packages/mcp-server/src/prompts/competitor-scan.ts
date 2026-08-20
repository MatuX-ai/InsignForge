/**
 * Prompt: competitor-scan —— 扫描 {domain} 领域的竞品
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerCompetitorScanPrompt(server: McpServer): void {
  server.prompt(
    'competitor-scan',
    '扫描指定领域的竞品。会调用 insightforge 的 competitor_analysis 工具, 返回竞品列表及其优劣势。',
    {
      domain: z
        .string()
        .min(1, 'domain 不能为空')
        .describe('要扫描的行业或赛道,例如 "AI 会议纪要"、"远程结对编程"、"笔记软件"'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe('期望返回的竞品数量,默认 5,最大 20'),
    },
    ({ domain, limit }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `请使用 insightforge 的 competitor_analysis 工具扫描 "${domain}" 领域的竞品 ` +
              `(最多 ${limit} 个)。\n\n` +
              `完成后请整理为竞品对比表:\n` +
              `- 竞品名称\n` +
              `- 核心定位(一句话)\n` +
              `- 主要优势\n` +
              `- 主要不足\n` +
              `- 市场角色(leader / challenger / niche)\n\n` +
              `并给出市场格局概述(集中度 / 主要差异点 / 我的差异化机会)。`,
          },
        },
      ],
    }),
  );
}