/**
 * 技术选型结果 Zod Schema
 *
 * AI 基于项目描述 + 市场调研报告,给出 3 套技术栈方案供用户选择:
 *   - 方案 A: 快速落地型 (成熟稳定,上手快)
 *   - 方案 B: 均衡推荐型 (AI 首推,综合最优)
 *   - 方案 C: 前沿探索型 (新技术,长期价值高)
 *
 * 每套方案包含: 前端 / 后端 / 数据库 / 部署 / 第三方服务 等维度的选型 + 理由
 */
import { z } from 'zod';

/** 单个技术选型项 */
export const TechOptionSchema = z.object({
  /** 技术名称,如 "React 18" */
  name: z.string().min(1),
  /** 选型理由,1-2 句话 */
  reason: z.string().min(10),
  /** 成熟度: mature / growing / emerging */
  maturity: z.enum(['mature', 'growing', 'emerging']),
  /** 社区活跃度评分 1-5 */
  community_score: z.number().min(1).max(5),
  /** 学习成本: low / medium / high */
  learning_curve: z.enum(['low', 'medium', 'high']),
});

/** 单套技术方案 */
export const TechStackPlanSchema = z.object({
  /** 方案标识: plan_a / plan_b / plan_c */
  plan_id: z.enum(['plan_a', 'plan_b', 'plan_c']),
  /** 方案名称,如 "快速落地方案" */
  plan_name: z.string().min(1),
  /** 方案一句话定位 */
  tagline: z.string().min(1),
  /** 适用场景描述 */
  suitable_for: z.string().min(10),
  /** 前端选型 */
  frontend: TechOptionSchema,
  /** 后端选型 */
  backend: TechOptionSchema,
  /** 数据库选型 */
  database: TechOptionSchema,
  /** 部署方案 */
  deployment: TechOptionSchema,
  /** 第三方服务/工具 (可选,0-5 项) */
  third_party: z.array(TechOptionSchema).max(5),
  /** 整体优势总结 */
  pros: z.array(z.string()).min(2).max(5),
  /** 整体劣势/风险 */
  cons: z.array(z.string()).min(1).max(4),
  /** 预估首版开发周期(人周) */
  estimated_weeks: z.number().min(1),
});

/** 技术选型完整响应 */
export const TechSelectionResponseSchema = z.object({
  /** AI 首推方案 ID */
  recommended: z.enum(['plan_a', 'plan_b', 'plan_c']),
  /** 三套方案 */
  plans: z.array(TechStackPlanSchema).length(3),
  /** 选型决策维度说明 (供前端展示对比表) */
  decision_dimensions: z.array(z.string()).min(3).max(6),
});

export type TechOption = z.infer<typeof TechOptionSchema>;
export type TechStackPlan = z.infer<typeof TechStackPlanSchema>;
export type TechSelectionResponse = z.infer<typeof TechSelectionResponseSchema>;
