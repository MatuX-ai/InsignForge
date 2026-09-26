/**
 * InsightForge 插件系统 - 类型定义
 *
 * v1.7.1 FR-13 设计目的:
 *   把原本硬编码的「落地页生成」抽象为可插拔能力,后续可扩展:
 *     - 接入 dsh (DeepSeek Harness) 官方生成器
 *     - 接入第三方落地页引擎(如 Carrd / Typedream)
 *     - 接入企业内部模板
 *
 * 与前端契约:
 *   POST /api/v1/projects/:id/landing 调用 builtin-landing 插件
 *   GET  /api/v1/plugins 列出所有已注册插件及其元信息
 *   GET  /api/v1/plugins/:id 列出特定插件详情
 *
 * 设计原则:
 *   - 插件以「能力类型(capability)」暴露,不是单一入口
 *   - 同一能力可注册多个插件,每个有 priority 数字,数字越大越优先
 *   - 插件被禁用(settings.enable.<pluginId> = false)时自动跳过
 *   - 插件抛错时,host 自动降级到下一个插件,而不是直接 500
 */
import type {
  LandingFormField,
  LandingInput,
  LandingPage,
} from '../utils/landingGenerator.js';

/** 插件元信息(供 /plugins 列表使用) */
export interface PluginManifest {
  /** 插件唯一 ID,前端可作为启用/禁用的 key */
  id: string;
  /** 人类可读名称 */
  name: string;
  /** 描述,Markdown 简短片段 */
  description: string;
  /** 版本,语义化版本字符串 */
  version: string;
  /** 提供的能力标签,前端可按标签筛选 */
  capabilities: PluginCapability[];
  /** 来源: builtin / dsh / external */
  source: 'builtin' | 'dsh' | 'external';
  /** 优先级,数字越大越优先;同能力多个插件时使用 */
  priority: number;
  /** 是否为默认插件(同能力下默认优先) */
  default?: boolean;
  /** 运行时启用状态(由 host 在返回时注入,PluginManifest 定义里 optional) */
  enabled?: boolean;
}

/** 当前唯一支持的能力 - 落地页生成 */
export type PluginCapability = 'landing.generate';

/**
 * 落地页生成器接口
 *
 * 输入:
 *   - LandingInput 同 landingGenerator.ts;可包含 cta / subtext / fields 等覆盖
 *   - project / report 是上下文,允许插件读用户上传过的关键词等
 *
 * 输出:
 *   - LandingPage;失败时 throw,host 会降级到下一个插件
 */
export interface LandingGeneratorPlugin {
  manifest: PluginManifest;
  generateLanding(
    input: LandingInput,
    context: LandingContext
  ): Promise<LandingPage>;
}

/**
 * 插件上下文 - 让插件可以读取项目元数据,而不仅仅是 LandingInput
 */
export interface LandingContext {
  project: {
    id: string;
    name: string;
    description: string;
  };
  report: {
    summary: string;
    market_size: string;
    pain_points: string[];
    opportunities: string[];
    market_heat: { trend: string; heat_score: number };
  };
  /** 用户自定义表单字段覆盖(若指定,plugin 应使用而非自己推断) */
  formFieldsOverride?: LandingFormField[];
}