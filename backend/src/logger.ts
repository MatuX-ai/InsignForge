/**
 * 结构化日志(基于 pino)
 * 开发环境带颜色与时间戳,生产环境输出 JSON 便于采集
 */
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development'
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