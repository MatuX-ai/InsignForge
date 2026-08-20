/**
 * 单元测试 —— 配置校验(validateConfig / tryValidateConfig / ConfigSchema)
 *
 * 覆盖 SDK-50 需求:缺失必填字段时抛错且提示明确。
 */
import { describe, it, expect } from 'vitest';
import { ConfigSchema, validateConfig, tryValidateConfig } from '../src/config.js';

const validBase = {
  llmApiKey: 'sk-test-123',
};

describe('ConfigSchema / validateConfig', () => {
  it('最小必填字段(仅 llmApiKey)可通过校验并补默认值', () => {
    const cfg = validateConfig(validBase);
    expect(cfg.llmApiKey).toBe('sk-test-123');
    expect(cfg.llmProvider).toBe('deepseek');
    expect(cfg.searchProvider).toBe('openserp');
    expect(cfg.searchEndpoint).toBe('http://localhost:18080');
    expect(cfg.dbPath).toBe('./data/insightforge.db');
    expect(cfg.cacheEnabled).toBe(true);
    expect(cfg.maxConcurrent).toBe(5);
    expect(cfg.logLevel).toBe('info');
  });

  it('缺失 llmApiKey 时抛 ZodError', () => {
    expect(() => validateConfig({})).toThrow(/llmApiKey/);
  });

  it('llmApiKey 为空字符串时抛错', () => {
    expect(() => validateConfig({ llmApiKey: '' })).toThrow(/必填/);
  });

  it('llmProvider 非法枚举值抛错', () => {
    expect(() =>
      validateConfig({ llmApiKey: 'k', llmProvider: 'mistral' as never })
    ).toThrow();
  });

  it('searchProvider 非法枚举值抛错', () => {
    expect(() =>
      validateConfig({ llmApiKey: 'k', searchProvider: 'baidu' as never })
    ).toThrow();
  });

  it('maxConcurrent 超出 1..32 范围抛错', () => {
    expect(() => validateConfig({ llmApiKey: 'k', maxConcurrent: 0 })).toThrow();
    expect(() => validateConfig({ llmApiKey: 'k', maxConcurrent: 64 })).toThrow();
  });

  it('maxConcurrent 非整数抛错', () => {
    expect(() => validateConfig({ llmApiKey: 'k', maxConcurrent: 2.5 })).toThrow();
  });

  it('llmBaseUrl 非法 URL 抛错', () => {
    expect(() =>
      validateConfig({ llmApiKey: 'k', llmBaseUrl: 'not-a-url' })
    ).toThrow();
  });

  it('logLevel 非法值抛错', () => {
    expect(() =>
      validateConfig({ llmApiKey: 'k', logLevel: 'verbose' as never })
    ).toThrow();
  });

  it('strict 模式:未知字段被拒绝', () => {
    expect(() =>
      validateConfig({ llmApiKey: 'k', unknownField: 'x' } as never)
    ).toThrow();
  });
});

describe('tryValidateConfig', () => {
  it('合法输入返回 { ok: true, config }', () => {
    const r = tryValidateConfig(validBase);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.llmApiKey).toBe('sk-test-123');
      expect(r.config.maxConcurrent).toBe(5);
    }
  });

  it('非法输入返回 { ok: false, error: 包含字段路径 }', () => {
    const r = tryValidateConfig({ llmApiKey: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('llmApiKey');
    }
  });

  it('多个错误串联成单条 error 字符串', () => {
    const r = tryValidateConfig({
      llmApiKey: '',
      maxConcurrent: 100,
      logLevel: 'silly' as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('llmApiKey');
      expect(r.error).toContain('maxConcurrent');
      expect(r.error).toContain('logLevel');
    }
  });
});

describe('ConfigSchema(直接使用)', () => {
  it('safeParse 不会抛错', () => {
    const r = ConfigSchema.safeParse({ llmApiKey: 'k' });
    expect(r.success).toBe(true);
  });

  it('缺少必填字段 success=false', () => {
    const r = ConfigSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});