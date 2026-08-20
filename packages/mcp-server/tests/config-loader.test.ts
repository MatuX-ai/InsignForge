/**
 * config-loader 单元测试
 *
 * 覆盖:
 * - parseCliArgs 所有选项 + 错误处理
 * - loadConfig 必填校验 (缺 llmApiKey 应抛 McpConfigError)
 * - loadConfigFile JSON 解析
 * - loadConfigFile YAML 解析
 * - readEnvOverrides 环境变量映射
 * - McpToolError 序列化(脱敏)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseCliArgs,
  loadConfig,
  loadConfigFile,
  buildConfigFromEnv,
  McpConfigError,
  McpToolError,
} from '../src/config-loader.js';

describe('parseCliArgs', () => {
  it('应返回默认参数(空 argv)', () => {
    const args = parseCliArgs([]);
    expect(args.transport).toBe('stdio');
    expect(args.httpPort).toBe(3002);
    expect(args.logLevel).toBe('info');
    expect(args.configPath).toBeUndefined();
    expect(args.showHelp).toBe(false);
  });

  it('应解析 --transport / --port / --log-level / --config', () => {
    const args = parseCliArgs([
      '--config',
      './config.json',
      '--transport',
      'http',
      '--port',
      '4000',
      '--log-level',
      'debug',
    ]);
    expect(args.configPath).toBe('./config.json');
    expect(args.transport).toBe('http');
    expect(args.httpPort).toBe(4000);
    expect(args.logLevel).toBe('debug');
  });

  it('应支持短选项 -c -t -p -l -h -v', () => {
    const args = parseCliArgs(['-c', 'x.yaml', '-t', 'http', '-p', '9000', '-l', 'warn', '-h']);
    expect(args.configPath).toBe('x.yaml');
    expect(args.transport).toBe('http');
    expect(args.httpPort).toBe(9000);
    expect(args.logLevel).toBe('warn');
    expect(args.showHelp).toBe(true);
  });

  it('非法 --transport 值应抛 McpConfigError', () => {
    expect(() => parseCliArgs(['--transport', 'tcp'])).toThrow(McpConfigError);
  });

  it('非法 --port 值应抛 McpConfigError', () => {
    expect(() => parseCliArgs(['--port', '99999'])).toThrow(McpConfigError);
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(McpConfigError);
  });

  it('未知参数应抛 McpConfigError', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow(McpConfigError);
  });
});

describe('loadConfig (环境变量模式)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('缺 INSIGHTFORGE_LLM_API_KEY 应抛 McpConfigError', () => {
    delete process.env.INSIGHTFORGE_LLM_API_KEY;
    expect(() => loadConfig([])).toThrow(McpConfigError);
  });

  it('提供 llmApiKey 应返回完整 Config', () => {
    process.env.INSIGHTFORGE_LLM_API_KEY = 'sk-test-1234567890abcdef';
    process.env.INSIGHTFORGE_LLM_PROVIDER = 'deepseek';
    const { config, transport, httpPort } = loadConfig([]);
    expect(config.llmApiKey).toBe('sk-test-1234567890abcdef');
    expect(config.llmProvider).toBe('deepseek');
    expect(transport).toBe('stdio');
    expect(httpPort).toBe(3002);
  });

  it('--help 应短路返回, 不抛错', () => {
    process.env.INSIGHTFORGE_LLM_API_KEY = 'sk-test';
    const { args } = loadConfig(['--help']);
    expect(args.showHelp).toBe(true);
  });

  it('INSIGHTFORGE_CACHE_ENABLED=true / false 应被正确解析', () => {
    process.env.INSIGHTFORGE_LLM_API_KEY = 'sk-test';
    process.env.INSIGHTFORGE_CACHE_ENABLED = 'false';
    const { config } = loadConfig([]);
    expect(config.cacheEnabled).toBe(false);
  });

  it('INSIGHTFORGE_MAX_CONGRESS 不合法时降级为 SDK 默认', () => {
    process.env.INSIGHTFORGE_LLM_API_KEY = 'sk-test';
    process.env.INSIGHTFORGE_MAX_CONCURRENT = 'not-a-number';
    const { config } = loadConfig([]);
    expect(config.maxConcurrent).toBe(5); // SDK 默认
  });
});

describe('loadConfigFile', () => {
  it('应解析简单 JSON 文件', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const tmpFile = path.join(os.tmpdir(), `insightforge-cfg-${Date.now()}.json`);
    await fs.writeFile(
      tmpFile,
      JSON.stringify({ llmApiKey: 'sk-file', maxConcurrent: 10 }),
      'utf8',
    );
    try {
      const data = loadConfigFile(tmpFile);
      expect(data.llmApiKey).toBe('sk-file');
      expect(data.maxConcurrent).toBe(10);
    } finally {
      await fs.unlink(tmpFile);
    }
  });

  it('应解析简单 YAML 文件', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const tmpFile = path.join(os.tmpdir(), `insightforge-cfg-${Date.now()}.yaml`);
    const yaml = [
      'llmApiKey: sk-yaml',
      'maxConcurrent: 8',
      'cacheEnabled: true',
      '',
    ].join('\n');
    await fs.writeFile(tmpFile, yaml, 'utf8');
    try {
      const data = loadConfigFile(tmpFile);
      expect(data.llmApiKey).toBe('sk-yaml');
      expect(data.maxConcurrent).toBe(8);
      expect(data.cacheEnabled).toBe(true);
    } finally {
      await fs.unlink(tmpFile);
    }
  });

  it('读取不存在文件应抛 McpConfigError', () => {
    expect(() => loadConfigFile('/nonexistent/insightforge-test.json')).toThrow(McpConfigError);
  });
});

describe('buildConfigFromEnv', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('缺 LLM_API_KEY 应抛错', () => {
    delete process.env.INSIGHTFORGE_LLM_API_KEY;
    expect(() => buildConfigFromEnv()).toThrow(McpConfigError);
  });

  it('提供 LLM_API_KEY 应返回 Config', () => {
    process.env.INSIGHTFORGE_LLM_API_KEY = 'sk-direct';
    const cfg = buildConfigFromEnv();
    expect(cfg.llmApiKey).toBe('sk-direct');
    expect(cfg.llmProvider).toBe('deepseek');
  });
});

describe('McpToolError', () => {
  it('toJSON() 应输出脱敏后的代码/消息/上下文', () => {
    const err = new McpToolError('E_LLM_AUTH', 'invalid api key sk-supersecret1234567890abcdef', {
      context: { provider: 'deepseek' },
    });
    const json = err.toJSON();
    expect(json.code).toBe('E_LLM_AUTH');
    expect(json.message).not.toContain('sk-supersecret1234567890abcdef');
    expect(json.message).toContain('[REDACTED_API_KEY]');
    expect(json.context).toEqual({ provider: 'deepseek' });
  });

  it('Bearer token 应被脱敏', () => {
    const err = new McpToolError(
      'E_LLM_AUTH',
      'Authorization: Bearer sk-1234567890abcdefghij',
    );
    expect(err.message).toContain('Bearer [REDACTED]');
  });
});