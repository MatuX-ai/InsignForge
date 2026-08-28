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
  /** 技术名称,如 "React 19" */
  name: z.string().min(1),
  /** 选型理由,至少一句完整中文,说明与项目的匹配点和未选替代方案的取舍 */
  reason: z.string().min(10),
  /** 成熟度: mature / growing / emerging */
  maturity: z.enum(['mature', 'growing', 'emerging']),
  /** 社区活跃度评分 1-5 */
  community_score: z.number().min(1).max(5),
  /** 学习成本: low / medium / high */
  learning_curve: z.enum(['low', 'medium', 'high']),
});

const FrontendStackSchema = z.object({
  framework: TechOptionSchema,
  ui: TechOptionSchema,
  state_management: TechOptionSchema,
  build_tool: TechOptionSchema,
});

const BackendStackSchema = z.object({
  language: TechOptionSchema,
  framework: TechOptionSchema,
  auth: TechOptionSchema,
  middleware: TechOptionSchema,
});

const DatabaseStackSchema = z.object({
  primary: TechOptionSchema,
  cache: TechOptionSchema.optional(),
  search: TechOptionSchema.optional(),
});

const DeploymentStackSchema = z.object({
  container: TechOptionSchema,
  ci_cd: TechOptionSchema,
  hosting: TechOptionSchema,
});

const ThirdPartyOptionSchema = TechOptionSchema.extend({
  category: z.string().min(1),
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
  /** 整体架构、关键组件与主要数据流 */
  architecture: z.string().min(20).max(800),
  /** 对当前项目的适配度 1-5 */
  fit_score: z.number().min(1).max(5),
  /** 方案当前风险等级 */
  risk_level: z.enum(['low', 'medium', 'high']),
  /** 前端完整技术组合 */
  frontend: FrontendStackSchema,
  /** 后端完整技术组合 */
  backend: BackendStackSchema,
  /** 数据库及确有必要的缓存/搜索 */
  database: DatabaseStackSchema,
  /** 部署完整技术组合 */
  deployment: DeploymentStackSchema,
  /** 第三方服务/工具 (可选,0-5 项) */
  third_party: z.array(ThirdPartyOptionSchema).max(5),
  /** 整体优势总结 */
  pros: z.array(z.string()).min(2).max(5),
  /** 整体劣势/风险 */
  cons: z.array(z.string()).min(1).max(4),
  /** 预估首版开发周期(人周) */
  estimated_weeks: z.number().min(1),
});

const TechSelectionPlansSchema = z
  .array(TechStackPlanSchema)
  .length(3)
  .superRefine((plans, ctx) => {
    const seen = new Set<string>();
    for (const [index, plan] of plans.entries()) {
      if (seen.has(plan.plan_id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'plan_id 不能重复',
          path: [index, 'plan_id'],
        });
      }
      seen.add(plan.plan_id);
    }
  });

/** 技术选型完整响应 */
export const TechSelectionResponseSchema = z
  .object({
    /** AI 首推方案 ID */
    recommended: z.enum(['plan_a', 'plan_b', 'plan_c']),
    /** 为什么当前项目的首推方案适配度最高 */
    recommendation_reason: z.string().min(40).max(600),
    /** 会影响选型但输入未提供的关键信息 */
    key_assumptions: z.array(z.string().min(5)).min(2).max(6),
    /** 三套且 plan_id 各异的方案 */
    plans: TechSelectionPlansSchema,
    /** 选型决策维度说明 (供前端展示对比表) */
    decision_dimensions: z.array(z.string()).min(3).max(6),
  })
  .superRefine((response, ctx) => {
    if (!response.plans.some((plan) => plan.plan_id === response.recommended)) {
      ctx.addIssue({
        code: 'custom',
        message: 'recommended 必须指向 plans 中存在的方案',
        path: ['recommended'],
      });
    }
  });

export type TechOption = z.infer<typeof TechOptionSchema>;
export type TechStackPlan = z.infer<typeof TechStackPlanSchema>;
export type TechSelectionResponse = z.infer<typeof TechSelectionResponseSchema>;
