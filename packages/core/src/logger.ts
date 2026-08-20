/**
 * pino 子实例 logger —— InsightForge SDK standalone 版本
 *
 * 与原 dsh-plugin/src/logger.ts 区别:
 * 1. 不再依赖 dsh 上下文(没有 ctx.logger 概念)
 * 2. name 改为 'insightforge-core'
 * 3. 日志级别可通过 Config.logLevel 动态调整(setLogLevel())
 * 4. 仍保留 pino-pretty 优雅降级
 *
 * 实现细节:
 * - pino-pretty 是可选依赖,缺失时优雅降级为标准 JSON 输出
 * - dev / test 环境尝试启用 pino-pretty;production 强制 JSON
 */
import pino, { type Logger as PinoLogger } from 'pino';
import type { Config } from './config-types.js';

function hasPinoPretty(): boolean {
  try {
    // 同步探测 pino-pretty 是否安装,避免破坏 require 缓存
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

const initialLevel =
  process.env.LOG_LEVEL ??
  process.env.INSIGHTFORGE_LOG_LEVEL ??
  'info';

const isDev = process.env.NODE_ENV !== 'production';

function buildLogger(level: string): PinoLogger {
  return pino({
    name: 'insightforge-core',
    level,
    ...(isDev && hasPinoPretty()
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}

/** 进程级 logger,初始按 env 推断 */
export const logger = buildLogger(initialLevel);

/**
 * 根据 Config 调整 logger 级别
 * 在 InsightForgeCore 构造函数中调用一次即可
 */
export function applyLogLevel(config: Pick<Config, 'logLevel'>): void {
  if (config.logLevel) {
    logger.level = config.logLevel;
  }
}

export type Logger = typeof logger;
