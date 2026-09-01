/**
 * 调研编排服务
 * 串联"关键词 → 搜索/抓取 → 聚合 → LLM 报告 → 入库"全流程
 *
 * Phase 4: 接入 MarketResearcher 智能体,完整实现真实调研
 */
import { ProjectService } from './ProjectService.js';
import { ExecutionService } from './ExecutionService.js';
import { ReportService } from './ReportService.js';
import { MarketResearcher } from '../agents/MarketResearcher.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { MissingLlmApiKeyError } from './llm/LLMClient.js';
import { SourceError, sourceErrorKindToCode } from './search/reliability.js';
import type { Execution } from '../types/index.js';

/**
 * 异步触发调研(立即返回 execution_id)
 * 实际工作在后台进行
 */
export async function triggerResearch(projectId: string): Promise<Execution> {
  const project = ProjectService.getById(projectId);
  if (!project) throw new Error(`项目不存在: ${projectId}`);

  // 更新项目状态
  ProjectService.updateStatus(projectId, 'analyzing', '开始调研...');

  // 创建执行记录
  const execution = ExecutionService.create(projectId);

  // 异步执行(不 await,立即返回)
  void runResearch(execution.id, projectId, project.description).catch((err) => {
    logger.error({ err, projectId }, '调研过程异常');
    ExecutionService.appendLog(execution.id, 'error', String(err));
    ExecutionService.markFinished(execution.id, 'failed');
    ProjectService.updateStatus(projectId, 'failed', `调研失败: ${err.message}`);
  });

  return execution;
}

/**
 * 真正执行调研(Phase 4 接入智能体)
 */
async function runResearch(
  executionId: string,
  projectId: string,
  description: string
): Promise<void> {
  const stepUpdate = (step: string) => {
    ExecutionService.updateStep(executionId, step);
    ProjectService.updateStatus(projectId, 'analyzing', step);
    ExecutionService.appendLog(executionId, 'info', step);
  };

  try {
    // 调用智能体(MarketResearcher 内部已串联 关键词→采集→报告)
    const report = await MarketResearcher.run(
      { projectId, description },
      stepUpdate
    );

    // 保存报告
    ReportService.save(projectId, report);

    // 标记完成
    stepUpdate('报告已生成');
    ExecutionService.markFinished(executionId, 'success');
    ProjectService.updateStatus(projectId, 'completed', '完成');
    logger.info({ projectId, executionId }, '调研全部完成');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, projectId }, '调研流程失败');
    ExecutionService.appendLog(executionId, 'error', message);
    ExecutionService.markFinished(executionId, 'failed');
    // 识别特定业务错误(仅内存),供前端弹窗 / 友好提示
    if (err instanceof MissingLlmApiKeyError) {
      ExecutionService.setErrorCode(executionId, 'MISSING_API_KEY');
    } else if (err instanceof SourceError) {
      // 多源采集引擎细分错误(v1.3),前端会映射为具体中文原因 + 是否可重试
      ExecutionService.setErrorCode(executionId, sourceErrorKindToCode(err.kind));
    }
    ProjectService.updateStatus(projectId, 'failed', message);
  }
}

/**
 * 检查执行是否超时
 */
export function isExecutionStuck(execution: Execution): boolean {
  if (execution.status !== 'running') return false;
  const startedAt = new Date(execution.started_at).getTime();
  const elapsed = (Date.now() - startedAt) / 1000;
  return elapsed > config.RESEARCH_TIMEOUT;
}