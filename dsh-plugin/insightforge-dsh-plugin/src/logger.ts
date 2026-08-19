/**
 * pino 子实例 logger
 *
 * 在 dsh 上下文中,日志应输出到 ctx.logger(由框架注入);
 * 此处提供 fallback logger,仅在没有 ctx 时使用。
 *
 * 实现细节:
 * - 仅在 NODE_ENV !== 'production' 时尝试启用 pino-pretty
 * - pino-pretty 是可选依赖,若未安装则优雅降级为标准 JSON 输出
 * - 这样保证测试环境与最小化部署都能直接跑
 */
import pino from 'pino';

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

/** 进程级 fallback logger,可被 apply() 中的 ctx.logger 覆盖 */
export const logger = pino({
  name: 'insightforge-dsh-plugin',
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV !== 'production' && hasPinoPretty()
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

export type Logger = typeof logger;