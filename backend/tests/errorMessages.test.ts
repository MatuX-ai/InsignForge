/**
 * backend/src/lib/errorMessages.ts 单元测试
 *
 * 目的:
 *   - 保证后端"错误码 → 文案"映射表 **与前端 frontend/src/lib/errorMessages.ts 一一对应**。
 *     前端那份不参与后端 vitest,这里通过比对 key 集合 + 关键字段类型,
 *     防止双端漂移后出现"前端 fallback 文案"误导用户。
 *
 * 设计:
 *   - 测试纯数据 + 函数;不引入 React/Vite/JSX
 *   - 关键字段(title/detail/retryable)类型不能退化
 */
import { describe, it, expect } from 'vitest';
import {
  BACKEND_FRIENDLY_ERRORS,
  explainErrorForLog,
  type BackendFriendlyError,
} from '../src/lib/errorMessages.js';

/** 与 backend/src/types/index.ts ErrorCode 保持一致的并集(测时用作白名单) */
const EXPECTED_KEYS = [
  'MISSING_API_KEY',
  'INTERNAL_ERROR',
  'SOURCE_NETWORK',
  'SOURCE_TIMEOUT',
  'SOURCE_RATE_LIMIT',
  'SOURCE_SERVER_5XX',
  'SOURCE_BAD_GATEWAY',
  'SOURCE_UNKNOWN_HTTP',
  'SOURCE_CLIENT_4XX',
  'SOURCE_PARSE',
  'SOURCE_CIRCUIT_OPEN',
  'SOURCE_VALIDATION',
] as const;

describe('BACKEND_FRIENDLY_ERRORS 映射完整性', () => {
  it('key 集合与 ErrorCode 一一对应(无遗漏 / 无多出)', () => {
    expect(Object.keys(BACKEND_FRIENDLY_ERRORS).sort()).toEqual(
      [...EXPECTED_KEYS].sort()
    );
  });

  it('每条记录都有 title + detail + retryable 字段', () => {
    for (const [code, fe] of Object.entries(BACKEND_FRIENDLY_ERRORS)) {
      expect(typeof fe.title, `${code}.title 应为 string`).toBe('string');
      expect(fe.title.length, `${code}.title 不应为空`).toBeGreaterThan(0);
      expect(fe.title.length, `${code}.title 不应过长(<=24 字)`).toBeLessThanOrEqual(24);

      expect(typeof fe.detail, `${code}.detail 应为 string`).toBe('string');
      expect(fe.detail.length, `${code}.detail 不应为空`).toBeGreaterThan(0);

      expect(typeof fe.retryable, `${code}.retryable 应为 boolean`).toBe('boolean');
    }
  });

  it('不可重试错误只覆盖"参数/鉴权"类(retryable=false)', () => {
    const noRetry: BackendFriendlyError[] = [
      BACKEND_FRIENDLY_ERRORS.MISSING_API_KEY,
      BACKEND_FRIENDLY_ERRORS.SOURCE_CLIENT_4XX,
      BACKEND_FRIENDLY_ERRORS.SOURCE_VALIDATION,
    ];
    for (const fe of noRetry) {
      expect(fe.retryable, `${fe.title} 应不可重试`).toBe(false);
    }
  });

  it('可重试错误覆盖"瞬时失败"类(retryable=true)', () => {
    const yes: BackendFriendlyError[] = [
      BACKEND_FRIENDLY_ERRORS.INTERNAL_ERROR,
      BACKEND_FRIENDLY_ERRORS.SOURCE_NETWORK,
      BACKEND_FRIENDLY_ERRORS.SOURCE_TIMEOUT,
      BACKEND_FRIENDLY_ERRORS.SOURCE_RATE_LIMIT,
      BACKEND_FRIENDLY_ERRORS.SOURCE_SERVER_5XX,
      BACKEND_FRIENDLY_ERRORS.SOURCE_BAD_GATEWAY,
      BACKEND_FRIENDLY_ERRORS.SOURCE_UNKNOWN_HTTP,
      BACKEND_FRIENDLY_ERRORS.SOURCE_PARSE,
      BACKEND_FRIENDLY_ERRORS.SOURCE_CIRCUIT_OPEN,
    ];
    for (const fe of yes) {
      expect(fe.retryable, `${fe.title} 应可重试`).toBe(true);
    }
  });

  it('文案里不应出现源码泄露字符串(便于回归追踪)', () => {
    for (const [code, fe] of Object.entries(BACKEND_FRIENDLY_ERRORS)) {
      expect(fe.title.includes('undefined'), `${code} title 含 undefined`).toBe(false);
      expect(fe.title.includes('null'), `${code} title 含 null`).toBe(false);
      expect(fe.title.includes('[object Object]'), `${code} title 序列化错误`).toBe(false);
    }
  });
});

describe('explainErrorForLog', () => {
  it('返回与映射表同结构的对象', () => {
    const r = explainErrorForLog('SOURCE_NETWORK');
    expect(r).toEqual(BACKEND_FRIENDLY_ERRORS.SOURCE_NETWORK);
  });

  it('不同码返回不同文案', () => {
    const a = explainErrorForLog('SOURCE_RATE_LIMIT');
    const b = explainErrorForLog('SOURCE_CIRCUIT_OPEN');
    expect(a.title).not.toBe(b.title);
  });
});