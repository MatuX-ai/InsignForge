/**
 * competitor_analysis 工具 —— 文档 3.1 节 / v0.2.0
 *
 * 触发场景:"帮我看看这个赛道有哪些竞品"
 *
 * 参数:
 * - domain: 行业/赛道关键词(必填)
 * - limit: 期望返回的竞品数量(可选,默认 5,最大 20)
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { InsightForgeCore } from '../core/researcher.js';
import type { CompetitorEntry } from '../types.js';

export interface CompetitorAnalysisArgs {
  domain: string;
  limit?: number;
}

export function competitorAnalysisTool(forge: InsightForgeCore) {
  return defineTool<CompetitorAnalysisArgs, CompetitorEntry[]>({
    name: 'competitor_analysis',
    description:
      '分析指定行业/赛道的主要竞品,返回竞品名称、定位、优劣势、市场角色(leader/challenger/niche)。当用户希望了解某个领域的市场格局时使用。',
    parameters: {
      domain: {
        type: 'string',
        required: true,
        description: '行业或赛道关键词,例如"AI 会议纪要"、"远程结对编程"',
      },
      limit: {
        type: 'number',
        required: false,
        description: '期望返回的竞品数量,默认 5,最大 20',
        default: 5,
      },
    },
    output: {
      render: (_args, competitors) => [
        {
          type: 'text',
          text:
            competitors.length === 0
              ? '未识别到竞品'
              : `识别到 ${competitors.length} 个相关竞品:\n` +
                competitors
                  .map(
                    (c, i) =>
                      `[${i + 1}] ${c.name} _(${c.market_position ?? '未知'})_\n` +
                      `${c.description}\n` +
                      (c.url ? `链接:${c.url}\n` : '') +
                      (c.strengths?.length ? `优势:${c.strengths.join(' / ')}\n` : '') +
                      (c.weaknesses?.length ? `不足:${c.weaknesses.join(' / ')}` : '')
                  )
                  .join('\n\n'),
        },
        { type: 'json', data: competitors },
      ],
    },
    async execute(args) {
      if (!args.domain || args.domain.trim().length === 0) {
        throw new Error('参数 domain 必须是非空字符串');
      }
      const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
      const competitors = await forge.analyzeCompetitors(args.domain.trim(), limit);
      return competitors;
    },
  });
}