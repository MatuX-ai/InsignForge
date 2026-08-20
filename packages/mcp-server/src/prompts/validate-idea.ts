/**
 * Prompt: validate-idea —— 用 insightforge 验证 {idea} 的市场可行性
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerValidateIdeaPrompt(server: McpServer): void {
  server.prompt(
    'validate-idea',
    '用 insightforge 市场调研工具验证产品想法的市场可行性。会自动调用 market_research 工具生成完整报告。',
    {
      idea: z.string().min(3, 'idea 至少 3 个字符').describe('要验证的产品想法或项目描述'),
      depth: z
        .enum(['quick', 'standard', 'deep'])
        .default('standard')
        .describe('调研深度(默认 standard): quick 60s, standard 180s, deep 360s'),
    },
    ({ idea, depth }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `请使用 insightforge 的 market_research 工具验证以下产品想法的市场可行性:\n\n` +
              `想法:${idea}\n\n` +
              `建议使用 ${depth} 档深度。完成后请总结报告的核心结论(` +
              `市场热度评分 / 主要竞品 / 用户痛点 / 关键风险 / 关键机会), ` +
              `并给出 "值得继续推进 / 需要进一步验证 / 建议放弃" 三档结论。`,
          },
        },
      ],
    }),
  );
}