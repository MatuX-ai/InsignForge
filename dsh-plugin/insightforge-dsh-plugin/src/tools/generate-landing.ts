/**
 * generate_landing 工具 —— 文档 3.1 节 / v0.2.0
 *
 * 触发场景:"为这个想法生成一个测试页面"
 *
 * 参数:
 * - idea: 产品想法/标题(必填)
 * - value_proposition: 核心价值主张(必填)
 * - call_to_action: CTA 按钮文案(可选,默认"加入等待列表")
 * - theme: light / dark(可选,默认 light)
 * - tagline: 副标题(可选)
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { generateLanding, type LandingInput } from '../core/landing.js';
import type { InsightForgeCore } from '../core/researcher.js';
import type { LandingPage } from '../types.js';

export interface GenerateLandingArgs extends LandingInput {}

export function generateLandingTool(_forge: InsightForgeCore) {
  return defineTool<GenerateLandingArgs, LandingPage>({
    name: 'generate_landing',
    description:
      '基于产品想法生成验证落地页 HTML(单文件响应式)。可保存为静态文件部署或通过 file:// 直接打开。当用户希望快速验证市场需求时使用。',
    parameters: {
      idea: {
        type: 'string',
        required: true,
        description: '产品想法 / 落地页主标题',
      },
      value_proposition: {
        type: 'string',
        required: true,
        description: '核心价值主张,一段话说明为谁解决什么问题',
      },
      call_to_action: {
        type: 'string',
        required: false,
        description: 'CTA 按钮文案,默认"加入等待列表"',
        default: '加入等待列表',
      },
      theme: {
        type: 'string',
        required: false,
        description: '页面主题:light(浅色)/ dark(深色)',
        enum: ['light', 'dark'],
        default: 'light',
      },
      tagline: {
        type: 'string',
        required: false,
        description: '可选副标题,显示在主标题下方',
      },
    },
    output: {
      render: (args, page) => [
        {
          type: 'text',
          text: `落地页已生成(${page.size} bytes, 主题:${page.theme})\n\n\`\`\`html\n${page.html}\n\`\`\``,
        },
        { type: 'html', text: page.html },
      ],
    },
    async execute(args) {
      if (!args.idea || args.idea.trim().length === 0) {
        throw new Error('参数 idea 必须是非空字符串');
      }
      if (!args.value_proposition || args.value_proposition.trim().length === 0) {
        throw new Error('参数 value_proposition 必须是非空字符串');
      }
      if (args.theme && !['light', 'dark'].includes(args.theme)) {
        throw new Error(`参数 theme 必须是 light/dark 之一,得到: ${args.theme}`);
      }
      return generateLanding(args);
    },
  });
}