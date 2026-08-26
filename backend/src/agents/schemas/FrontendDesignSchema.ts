/**
 * 前端设计方案 Zod Schema
 *
 * AI 基于项目场景和用户画像,给出 2-3 套前端设计方案供用户选择:
 *   - 设计风格 (极简商务 / 科技感 / 温馨友好 / 专业工具 等)
 *   - 交互模式 (单页应用 / 多页导航 / 仪表盘式 / 向导式 等)
 *   - 视觉风格 (配色 / 字体 / 动效 等)
 *   - 响应式策略 (移动优先 / 桌面优先 / 双端并重 等)
 */
import { z } from 'zod';

/** 单套前端设计方案 */
export const FrontendDesignPlanSchema = z.object({
  /** 方案标识: plan_a / plan_b / plan_c */
  plan_id: z.enum(['plan_a', 'plan_b', 'plan_c']),
  /** 方案名称,如 "极简商务风" */
  plan_name: z.string().min(1),
  /** 方案一句话定位 */
  tagline: z.string().min(1),
  /** 适用场景与用户画像 */
  suitable_for: z.string().min(10),
  /** 设计风格描述 */
  design_style: z.object({
    /** 整体风格关键词,3-5 个 */
    keywords: z.array(z.string()).min(3).max(6),
    /** 配色方案 (主色 / 辅色 / 中性色) */
    color_palette: z.object({
      primary: z.string().min(1),
      secondary: z.string().min(1),
      neutral: z.string().min(1),
      accent: z.string().optional(),
    }),
    /** 字体方案 */
    typography: z.string().min(5),
    /** 动效风格 */
    motion: z.string().min(5),
  }),
  /** 交互模式 */
  interaction_pattern: z.object({
    /** 主导航模式 */
    navigation: z.string().min(5),
    /** 核心交互流程描述 */
    core_flow: z.string().min(10),
    /** 信息架构特点 */
    info_architecture: z.string().min(5),
  }),
  /** 响应式策略 */
  responsive_strategy: z.object({
    /** 优先级: mobile-first / desktop-first / equal */
    priority: z.enum(['mobile-first', 'desktop-first', 'equal']),
    /** 断点策略说明 */
    breakpoints: z.string().min(5),
    /** 移动端特殊设计 */
    mobile_specific: z.string().min(5),
  }),
  /** 推荐的 UI 组件库 */
  ui_library: z.object({
    name: z.string().min(1),
    reason: z.string().min(10),
  }),
  /** 整体优势 */
  pros: z.array(z.string()).min(2).max(4),
  /** 整体劣势/注意事项 */
  cons: z.array(z.string()).min(1).max(3),
});

/** 前端设计方案完整响应 */
export const FrontendDesignResponseSchema = z.object({
  /** AI 首推方案 ID */
  recommended: z.enum(['plan_a', 'plan_b', 'plan_c']),
  /** 2-3 套方案 */
  plans: z.array(FrontendDesignPlanSchema).min(2).max(3),
  /** 设计决策维度说明 */
  decision_dimensions: z.array(z.string()).min(3).max(5),
});

export type FrontendDesignPlan = z.infer<typeof FrontendDesignPlanSchema>;
export type FrontendDesignResponse = z.infer<typeof FrontendDesignResponseSchema>;
