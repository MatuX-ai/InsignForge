/**
 * 技术选型服务
 *
 * 职责:
 *   1. 基于项目描述 + 市场调研报告,调用 LLM 生成 3 套技术栈方案
 *   2. 在内存中缓存选型结果,供前端轮询/复用
 *   3. 接收用户最终选择,持久化到项目上下文中
 *
 * 状态存储策略:
 *   - 按 projectId 维护,使用 Map
 *   - 进程重启后状态丢失 (符合 MVP 场景)
 */
import { chatJson } from './llm/LLMClient.js';
import { ProjectService } from './ProjectService.js';
import { ReportService } from './ReportService.js';
import { logger } from '../logger.js';
import {
  TECH_SELECTION_SYSTEM,
  buildTechSelectionUserPrompt,
} from '../agents/prompts/techSelection.js';
import {
  TechSelectionResponseSchema,
  type TechSelectionResponse,
  type TechStackPlan,
} from '../agents/schemas/TechSelectionSchema.js';

/** 技术选型任务状态 */
export interface TechSelectionJob {
  status: 'running' | 'success' | 'failed';
  current_step: string;
  started_at: string;
  finished_at: string | null;
  error_code: 'MISSING_API_KEY' | 'INTERNAL_ERROR' | null;
  error_message: string | null;
  /** 生成成功后的选型结果 */
  result: TechSelectionResponse | null;
  /** 用户最终选择的方案 ID (用户确认后设置) */
  selected_plan: 'plan_a' | 'plan_b' | 'plan_c' | null;
}

/** 模块级 Map: projectId -> TechSelectionJob */
const jobs = new Map<string, TechSelectionJob>();

function newRunningJob(): TechSelectionJob {
  return {
    status: 'running',
    current_step: '正在分析项目需求,搜索最新开源技术方案...',
    started_at: new Date().toISOString(),
    finished_at: null,
    error_code: null,
    error_message: null,
    result: null,
    selected_plan: null,
  };
}

export const TechSelectionService = {
  /**
   * 触发技术选型分析 - 立即返回 job,后台异步执行
   * 若该项目正在生成中,直接复用现有 job
   */
  trigger(projectId: string): TechSelectionJob {
    const existing = jobs.get(projectId);
    if (existing && existing.status === 'running') {
      return existing;
    }
    const job = newRunningJob();
    jobs.set(projectId, job);
    void runSelection(projectId, job).catch((err) => {
      logger.error({ err, projectId }, '技术选型分析未捕获异常');
    });
    return job;
  },

  /** 获取状态 */
  getStatus(projectId: string): TechSelectionJob | null {
    return jobs.get(projectId) ?? null;
  },

  /**
   * 用户确认选择某套方案
   * 返回选中的方案详情;若选型尚未完成则返回 null
   */
  selectPlan(
    projectId: string,
    planId: 'plan_a' | 'plan_b' | 'plan_c'
  ): TechStackPlan | null {
    const job = jobs.get(projectId);
    if (!job || job.status !== 'success' || !job.result) return null;
    const plan = job.result.plans.find((p) => p.plan_id === planId);
    if (!plan) return null;
    job.selected_plan = planId;
    logger.info({ projectId, planId }, '用户确认技术选型方案');
    return plan;
  },

  /** 获取用户已选方案 (若未选择则返回 null) */
  getSelectedPlan(projectId: string): TechStackPlan | null {
    const job = jobs.get(projectId);
    if (!job || !job.selected_plan || !job.result) return null;
    return job.result.plans.find((p) => p.plan_id === job.selected_plan) ?? null;
  },

  /** 重置 */
  reset(projectId: string): void {
    jobs.delete(projectId);
  },
};

/**
 * 后台执行:校验 -> 调用 LLM -> 校验 schema -> 更新状态
 */
async function runSelection(
  projectId: string,
  job: TechSelectionJob
): Promise<void> {
  try {
    const project = ProjectService.getById(projectId);
    if (!project) throw new Error('项目不存在');

    const reportRecord = ReportService.getByProjectId(projectId);
    if (!reportRecord) {
      throw new Error('报告尚未生成,请先完成市场调研');
    }

    job.current_step = '正在调用 AI 分析技术选型...';

    const reportJson = JSON.stringify(reportRecord.report_data, null, 2);
    const raw = await chatJson<unknown>(
      TECH_SELECTION_SYSTEM,
      buildTechSelectionUserPrompt(
        project.description,
        reportJson,
        project.name
      ),
      { temperature: 0.5, maxTokens: 8000 }
    );

    const parsed = TechSelectionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { err: parsed.error.format(), raw },
        '技术选型结果结构校验失败'
      );
      throw new Error(
        `AI 返回的技术选型结构不符合预期:${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
    }

    job.result = parsed.data;
    job.status = 'success';
    job.current_step = '技术选型分析完成,请选择方案';
    job.finished_at = new Date().toISOString();
    logger.info({ projectId }, '技术选型分析完成');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error_message = msg;
    job.finished_at = new Date().toISOString();
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : null;
    if (code === 'MISSING_API_KEY') {
      job.error_code = 'MISSING_API_KEY';
    } else {
      job.error_code = 'INTERNAL_ERROR';
    }
    job.current_step = `失败:${msg}`;
    logger.error({ err: msg, projectId }, '技术选型分析失败');
  }
}
