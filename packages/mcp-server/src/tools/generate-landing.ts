/**
 * generate_landing 工具 —— 文档 3.2.3
 *
 * 触发场景："为这个想法生成一个测试页面"
 *
 * 参数:
 * - idea: 产品想法 / 标题(必填)
 * - value_proposition: 核心价值主张(必填)
 * - call_to_action: CTA 按钮文案(可选, 默认"加入等待列表")
 * - theme: light / dark(可选, 默认 light)
 * - tagline: 副标题(可选)
 *
 * 实现: SDK generateLanding()(纯函数, 无 LLM 调用)
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { InsightForgeCore, LandingInput } from '@insightforge/core';
import { generateLanding } from '@insightforge/core';

import { classifyError, errorToMcpContent } from './errors.js';

const GenerateLandingInput = {
  idea: z.string().min(1, 'idea 不能为空').describe('产品想法 / 落地页主标题'),
  value_proposition: z
    .string()
    .min(1, 'value_proposition 不能为空')
    .describe('核心价值主张, 一段话说明为谁解决什么问题'),
  call_to_action: z
    .string()
    .default('加入等待列表')
    .describe('CTA 按钮文案, 默认 "加入等待列表"'),
  theme: z
    .enum(['light', 'dark'])
    .default('light')
    .describe('页面主题: light(浅色) / dark(深色)'),
  tagline: z.string().optional().describe('可选副标题, 显示在主标题下方'),
} as const;

export function registerGenerateLandingTool(
  server: McpServer,
  _core: InsightForgeCore,
): void {
  server.tool(
    'generate_landing',
    '基于产品想法生成可分享的验证落地页 HTML(单文件响应式)。' +
      '可保存为静态文件部署或通过 file:// 直接打开。' +
      '当用户希望快速验证市场需求、或为某个想法制作 demo 页面时使用。' +
      '示例触发语:"为 AI 会议纪要工具生成一个测试落地页"、"我想做个 landing page 验证需求"。',
    GenerateLandingInput,
    async (args: LandingInput) => {
      try {
        if (!args.idea || args.idea.trim().length === 0) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'E_VALIDATION: idea 必须是非空字符串' }],
          };
        }
        if (!args.value_proposition || args.value_proposition.trim().length === 0) {
          return {
            isError: true,
            content: [
              { type: 'text' as const, text: 'E_VALIDATION: value_proposition 必须是非空字符串' },
            ],
          };
        }

        const page = generateLanding(args);

        // 生成文件名(基于 idea 的 ASCII 安全转换)
        const fileName = sanitizeFileName(args.idea) + '.html';

        return {
          content: [
            {
              type: 'text' as const,
              text: `落地页已生成(${page.size} bytes, 主题:${page.theme}, 文件名:${fileName})\n\n请使用保存工具将以下 HTML 保存到本地, 然后通过浏览器或静态服务器打开。`,
            },
            {
              type: 'text' as const,
              text: page.html,
              _meta: {
                fileName,
                size: page.size,
                theme: page.theme,
              },
            },
            {
              type: 'text' as const,
              text: JSON.stringify({ fileName, size: page.size, theme: page.theme }, null, 2),
              _meta: { fileName, size: page.size },
            },
          ],
        };
      } catch (err) {
        const toolErr = classifyError(err);
        return {
          isError: true,
          content: errorToMcpContent(toolErr),
        };
      }
    },
  );
}

/**
 * 把任意字符串转为文件名安全的 ASCII:
 * - 中文 → 拼音(简化为保留为 unicode 由调用方决定; 此处只去非法字符)
 * - 去掉文件系统非法字符
 * - 截断到 64 字符
 */
function sanitizeFileName(input: string): string {
  return (
    input
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 64) || 'landing'
  );
}