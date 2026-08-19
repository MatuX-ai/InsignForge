/**
 * InsightForge dsh 插件 - Host 入口 —— 文档 2.2 / 4.3 节
 *
 * 导出 cordis 规范所需的所有符号:
 *   - name    插件标识
 *   - inject  依赖声明(需要 tools 工具注册表)
 *   - Config  schemastery 配置 Schema(7 项,详见 ./config.js)
 *   - apply   插件激活函数
 *
 * 框架会:
 *   1. 解析 cordis.yml,提取 insightforge-plugin.Config 段
 *   2. 用 schemastery 校验 -> 不通过则抛出 NFR-03 错误
 *   3. 等 inject 列表中的服务就绪后,调用 apply(ctx, config)
 *   4. 在 ctx.effect 注册的副作用,在 dispose 时统一清理(NFR-04)
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
import { InsightForgeCore } from './core/researcher.js';
import { logger } from './logger.js';
import { createDemandService } from './services/demand-service.js';
import { createReportService } from './services/report-service.js';
import { createSessionService } from './services/session-service.js';
import { competitorAnalysisTool } from './tools/competitor.js';
import { generateLandingTool } from './tools/generate-landing.js';
import { marketResearchTool } from './tools/market-research.js';
import { searchDemandTool } from './tools/search-demand.js';
import type { Config as ConfigType } from './config-types.js';

export { Config };
export type { Config as ConfigType } from './config-types.js';

/** 插件名(唯一标识,cordis 框架按此区分) */
export const name = 'insightforge-plugin';

/** 依赖声明:启动时需要工具注册表(文档 5.2 节) */
export const inject = ['tools'];

/**
 * 插件激活函数(文档 4.3 节模板)
 *
 * Cordis 在以下条件全部满足后调用:
 * 1. inject 列表中所有依赖服务已注册
 * 2. Config 校验通过
 *
 * @param ctx   Cordis 上下文(用于 effect/provide/inject)
 * @param config 已通过 schemastery 校验的 ResolvedConfig
 */
export function apply(ctx: Context, config: ConfigType): void {
  const start = Date.now();
  logger.info({ provider: config.llmProvider }, 'insightforge-plugin 正在加载...');

  // 1. 初始化核心(触发 DB 建表、缓存分配、信号量)
  const forge = new InsightForgeCore(config);

  // 2. 注册 dispose 钩子(NFR-04):ctx.onDispose 在框架 dispose 时调用
  ctx.onDispose(() => {
    forge.dispose();
    logger.info('insightforge-plugin 已卸载');
  });

  // 3. 注册 4 个核心工具
  ctx.tools.register(marketResearchTool(forge) as never);
  ctx.tools.register(searchDemandTool(forge) as never);
  ctx.tools.register(generateLandingTool(forge) as never);
  ctx.tools.register(competitorAnalysisTool(forge) as never);

  // 4. 注入 3 个预留服务(文档 3.3 节),其他插件可 inject 声明依赖
  ctx.provide('insightforge/demand', createDemandService(forge));
  ctx.provide('insightforge/report', createReportService(forge));
  ctx.provide('insightforge/session', createSessionService(forge));

  const elapsed = Date.now() - start;
  logger.info({ elapsedMs: elapsed }, 'insightforge-plugin 已注册(4 工具 + 3 服务)');
}

/**
 * 默认导出:在 dsh v0.1+ 中可直接被 `dsh plugin add insightforge-dsh-plugin` 加载
 * 同时支持 named imports { apply, Config, name, inject }
 */
export default { name, inject, Config, apply };