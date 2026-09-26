/**
 * 内置落地页生成插件 (v1.7.1 FR-13)
 *
 * 这是 InsightForge 内置的"兜底"落地页生成器,作为插件 host 的默认实现。
 *
 * 行为:
 *   - 调用 backend/src/utils/landingGenerator.ts 的 generateLanding
 *   - 自动从项目元数据 + 报告数据构造 LandingInput
 *   - 应用用户传入的 formFieldsOverride
 *
 * 后续 dsh (DeepSeek Harness) 集成时,可创建同 capability 的 dsh-landing 插件,
 * 设为更高 priority 即可自动顶替 builtin-landing。
 */
import { generateLanding } from '../../utils/landingGenerator.js';
import type {
  LandingContext,
  LandingGeneratorPlugin,
} from '../types.js';

export const builtinLandingPlugin: LandingGeneratorPlugin = {
  manifest: {
    id: 'builtin-landing',
    name: '内置落地页生成器',
    description:
      '基于项目元数据 + 市场报告自动构造响应式 HTML,内联 CSS 无外部依赖,内含智能 CTA 推荐与表单字段定制。',
    version: '1.0.0',
    capabilities: ['landing.generate'],
    source: 'builtin',
    priority: 50,
    default: true,
  },
  async generateLanding(input, context) {
    // 若用户在请求中传入 form_fields 覆盖,使用覆盖
    const finalInput = context.formFieldsOverride
      ? { ...input, form_fields: context.formFieldsOverride }
      : input;
    return generateLanding(finalInput);
  },
};