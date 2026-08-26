/**
 * 前端设计方案服务
 *
 * 职责:
 *   1. 基于项目描述 + 市场调研报告,调用 LLM 生成 2-3 套前端设计方案
 *   2. 在内存中缓存结果,供前端轮询/复用
 *   3. 接收用户最终选择
 */
import { chatJson } from './llm/LLMClient.js';
import { ProjectService } from './ProjectService.js';
import { ReportService } from './ReportService.js';
import { logger } from '../logger.js';
import {
  FRONTEND_DESIGN_SYSTEM,
  buildFrontendDesignUserPrompt,
} from '../agents/prompts/frontendDesign.js';
import {
  FrontendDesignResponseSchema,
  type FrontendDesignResponse,
  type FrontendDesignPlan,
} from '../agents/schemas/FrontendDesignSchema.js';

/** 前端设计方案任务状态 */
export interface FrontendDesignJob {
  status: 'running' | 'success' | 'failed';
  current_step: string;
  started_at: string;
  finished_at: string | null;
  error_code: 'MISSING_API_KEY' | 'INTERNAL_ERROR' | null;
  error_message: string | null;
  result: FrontendDesignResponse | null;
  selected_plan: 'plan_a' | 'plan_b' | 'plan_c' | null;
}

const jobs = new Map<string, FrontendDesignJob>();

function newRunningJob(): FrontendDesignJob {
  return {
    status: 'running',
    current_step: '正在分析用户画像与产品场景...',
    started_at: new Date().toISOString(),
    finished_at: null,
    error_code: null,
    error_message: null,
    result: null,
    selected_plan: null,
  };
}

export const FrontendDesignService = {
  trigger(projectId: string): FrontendDesignJob {
    const existing = jobs.get(projectId);
    if (existing && existing.status === 'running') {
      return existing;
    }
    const job = newRunningJob();
    jobs.set(projectId, job);
    void runDesign(projectId, job).catch((err) => {
      logger.error({ err, projectId }, '前端设计方案分析未捕获异常');
    });
    return job;
  },

  getStatus(projectId: string): FrontendDesignJob | null {
    return jobs.get(projectId) ?? null;
  },

  selectPlan(
    projectId: string,
    planId: 'plan_a' | 'plan_b' | 'plan_c'
  ): FrontendDesignPlan | null {
    const job = jobs.get(projectId);
    if (!job || job.status !== 'success' || !job.result) return null;
    const plan = job.result.plans.find((p) => p.plan_id === planId);
    if (!plan) return null;
    job.selected_plan = planId;
    logger.info({ projectId, planId }, '用户确认前端设计方案');
    return plan;
  },

  getSelectedPlan(projectId: string): FrontendDesignPlan | null {
    const job = jobs.get(projectId);
    if (!job || !job.selected_plan || !job.result) return null;
    return job.result.plans.find((p) => p.plan_id === job.selected_plan) ?? null;
  },

  reset(projectId: string): void {
    jobs.delete(projectId);
  },
};

async function runDesign(
  projectId: string,
  job: FrontendDesignJob
): Promise<void> {
  try {
    const project = ProjectService.getById(projectId);
    if (!project) throw new Error('项目不存在');

    const reportRecord = ReportService.getByProjectId(projectId);
    if (!reportRecord) {
      throw new Error('报告尚未生成,请先完成市场调研');
    }

    job.current_step = '正在调用 AI 生成前端设计方案...';

    const reportJson = JSON.stringify(reportRecord.report_data, null, 2);
    const raw = await chatJson<unknown>(
      FRONTEND_DESIGN_SYSTEM,
      buildFrontendDesignUserPrompt(
        project.description,
        reportJson,
        project.name
      ),
      { temperature: 0.6, maxTokens: 6000 }
    );

    const parsed = FrontendDesignResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { err: parsed.error.format(), raw },
        '前端设计方案结构校验失败'
      );
      throw new Error(
        `AI 返回的前端设计方案结构不符合预期:${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
    }

    job.result = parsed.data;
    job.status = 'success';
    job.current_step = '前端设计方案生成完成,请选择方案';
    job.finished_at = new Date().toISOString();
    logger.info({ projectId }, '前端设计方案生成完成');
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
    logger.error({ err: msg, projectId }, '前端设计方案生成失败');
  }
}
