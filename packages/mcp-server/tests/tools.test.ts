/**
 * tools 单元测试
 *
 * 覆盖:
 * - 4 个工具的输入校验
 * - 错误分类(classifyError)
 * - 脱敏(sanitize)
 * - formatReport 输出格式
 *
 * 注意: InsightForgeCore 通过 mock 注入,避免真实 LLM 调用。
 */
import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  InsightForgeCore,
  MarketReport,
  ResearchResult,
  DemandHit,
  CompetitorEntry,
  LandingPage,
  ResearchDepth,
} from '@insightforge/core';

import { registerMarketResearchTool, formatReport } from '../src/tools/market-research.js';
import { registerSearchDemandTool } from '../src/tools/search-demand.js';
import { registerGenerateLandingTool } from '../src/tools/generate-landing.js';
import { registerCompetitorTool } from '../src/tools/competitor.js';
import { classifyError, sanitize, errorToMcpContent, ERROR_KINDS } from '../src/tools/errors.js';
import { McpToolError } from '../src/config-loader.js';

/** 构造一个 mock InsightForgeCore */
function makeMockCore(overrides: Partial<InsightForgeCore> = {}): InsightForgeCore {
  return {
    config: {
      llmProvider: 'deepseek',
      llmApiKey: 'sk-test',
      searchEndpoint: 'http://localhost:18080',
      dbPath: ':memory:',
      cacheEnabled: false,
      maxConcurrent: 1,
      logLevel: 'info',
    } as any,
    semaphore: {} as any,
    reportCache: null,
    healthCheck: () => ({
      ok: true,
      db: false,
      config: true,
      llmAvailable: true,
      searchConfigured: true,
    }),
    dispose: vi.fn(),
    research: vi.fn(),
    extractKeywords: vi.fn(),
    generateReport: vi.fn(),
    buildContext: vi.fn(),
    searchDemand: vi.fn().mockReturnValue([]),
    demandStats: vi.fn().mockReturnValue({ total: 0, bySource: {} }),
    createSession: vi.fn(),
    getSession: vi.fn(),
    analyzeCompetitors: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as InsightForgeCore;
}

/** 构造一个 mock McpServer, 捕获 server.tool() 调用 */
function makeMockServer(): { server: McpServer; calls: Record<string, any> } {
  const calls: Record<string, any> = {};
  const server = {
    tool: (name: string, desc: string, schema: any, handler: any) => {
      calls[name] = { desc, schema, handler };
    },
    resource: (name: string, uri: any, opts: any, handler: any) => {
      calls[`resource:${name}`] = { uri, opts, handler };
    },
    prompt: (name: string, desc: string, schema: any, handler: any) => {
      calls[`prompt:${name}`] = { desc, schema, handler };
    },
  } as unknown as McpServer;
  return { server, calls };
}

// ============================================================
// formatReport
// ============================================================
describe('formatReport', () => {
  it('应输出 7 章节 markdown', () => {
    const report: MarketReport = {
      summary: '一句话总结',
      market_heat: {
        search_volume: 10000,
        discussion_count: 500,
        trend: 'rising',
        heat_score: 75,
      },
      competitors: [
        { name: '竞品A', description: 'A 的描述', strengths: ['强'], weaknesses: ['弱'] },
      ],
      pain_points: ['痛点1'],
      market_size: '10亿',
      risks: ['风险1'],
      opportunities: ['机会1'],
      sources: [{ title: '来源1', url: 'https://example.com' }],
      generated_at: '2026-08-20T10:00:00Z',
      depth: 'standard',
      keywords: ['kw1', 'kw2'],
    };
    const out = formatReport(report);
    expect(out).toContain('# 市场调研报告');
    expect(out).toContain('## 1. 执行摘要');
    expect(out).toContain('## 2. 市场热度');
    expect(out).toContain('## 3. 竞品识别');
    expect(out).toContain('## 4. 用户痛点');
    expect(out).toContain('## 5. 市场规模估算');
    expect(out).toContain('## 6. 风险');
    expect(out).toContain('## 7. 机会');
    expect(out).toContain('[来源1](https://example.com)');
    expect(out).toContain('kw1、kw2');
  });
});

// ============================================================
// market_research tool
// ============================================================
describe('market_research tool', () => {
  it('应注册并暴露 handler', () => {
    const { server, calls } = makeMockServer();
    const core = makeMockCore();
    registerMarketResearchTool(server, core);
    expect(calls['market_research']).toBeDefined();
    expect(calls['market_research'].desc).toContain('市场调研');
    expect(typeof calls['market_research'].handler).toBe('function');
  });

  it('idea 长度 < 3 应返回 isError', async () => {
    const { server, calls } = makeMockServer();
    const core = makeMockCore();
    registerMarketResearchTool(server, core);
    const result = await calls['market_research'].handler({ idea: 'ab', depth: 'standard' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('E_VALIDATION');
  });

  it('成功调用应返回 report + sessionId', async () => {
    const { server, calls } = makeMockServer();
    const fakeReport: MarketReport = {
      summary: 's',
      market_heat: {
        search_volume: 1,
        discussion_count: 1,
        trend: 'stable',
        heat_score: 50,
      },
      competitors: [],
      pain_points: [],
      market_size: '',
      risks: [],
      opportunities: [],
      sources: [],
      generated_at: '2026-08-20T10:00:00Z',
      depth: 'standard',
      keywords: ['kw'],
    };
    const core = makeMockCore({
      research: vi.fn().mockResolvedValue({
        report: fakeReport,
        fromCache: false,
        aggregate: { inserted: 0, unique: 0, bySource: {} as any },
        durationMs: 1234,
        sessionId: 'sess-123',
      } as ResearchResult),
    });
    registerMarketResearchTool(server, core);
    const result = await calls['market_research'].handler({
      idea: '测试想法',
      depth: 'standard',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('市场调研报告');
    expect(result.content[1].text).toContain('sess-123');
    expect(result.content[1]._meta.sessionId).toBe('sess-123');
    expect(core.research).toHaveBeenCalledWith({
      idea: '测试想法',
      depth: 'standard',
    });
  });

  it('SDK 抛错应被分类为 E_LLM_* 并 isError=true', async () => {
    const { server, calls } = makeMockServer();
    const core = makeMockCore({
      research: vi.fn().mockRejectedValue(new Error('rate limit exceeded 429')),
    });
    registerMarketResearchTool(server, core);
    const result = await calls['market_research'].handler({
      idea: '测试想法',
      depth: 'standard',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/E_LLM_RATE_LIMIT|E_SEARCH_RATE_LIMIT/);
  });
});

// ============================================================
// search_demand tool
// ============================================================
describe('search_demand tool', () => {
  it('空 query 应返回 E_VALIDATION', async () => {
    const { server, calls } = makeMockServer();
    registerSearchDemandTool(server, makeMockCore());
    const result = await calls['search_demand'].handler({ query: '', limit: 20 });
    expect(result.isError).toBe(true);
  });

  it('成功应返回 hits', async () => {
    const { server, calls } = makeMockServer();
    const core = makeMockCore({
      searchDemand: vi.fn().mockReturnValue([
        {
          id: '1',
          title: 't',
          content: 'c',
          source: 'reddit' as const,
          url: 'https://example.com',
          author: null,
          category: null,
          sentiment_score: 0,
          engagement: 100,
          tags: null,
          project_id: 'p',
          crawled_at: '2026-08-20',
        },
      ]),
    });
    registerSearchDemandTool(server, core);
    const result = await calls['search_demand'].handler({
      query: 'AI',
      limit: 20,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[1].text).toContain('"count": 1');
  });
});

// ============================================================
// generate_landing tool
// ============================================================
describe('generate_landing tool', () => {
  it('应返回 html + fileName', async () => {
    const { server, calls } = makeMockServer();
    registerGenerateLandingTool(server, makeMockCore());
    const result = await calls['generate_landing'].handler({
      idea: 'AI 会议纪要',
      value_proposition: '自动总结会议',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[1].text).toContain('<!DOCTYPE html>');
    expect(result.content[2].text).toContain('"fileName"');
  });

  it('空 idea 应返回 E_VALIDATION', async () => {
    const { server, calls } = makeMockServer();
    registerGenerateLandingTool(server, makeMockCore());
    const result = await calls['generate_landing'].handler({
      idea: '',
      value_proposition: 'x',
    });
    expect(result.isError).toBe(true);
  });
});

// ============================================================
// competitor_analysis tool
// ============================================================
describe('competitor_analysis tool', () => {
  it('空 domain 应返回 E_VALIDATION', async () => {
    const { server, calls } = makeMockServer();
    registerCompetitorTool(server, makeMockCore());
    const result = await calls['competitor_analysis'].handler({ domain: '', limit: 5 });
    expect(result.isError).toBe(true);
  });

  it('成功应返回竞品列表', async () => {
    const { server, calls } = makeMockServer();
    const core = makeMockCore({
      analyzeCompetitors: vi.fn().mockResolvedValue([
        {
          name: '竞品A',
          description: 'desc',
          strengths: ['s1'],
          weaknesses: ['w1'],
          market_position: 'leader',
        } as CompetitorEntry,
      ]),
    });
    registerCompetitorTool(server, core);
    const result = await calls['competitor_analysis'].handler({
      domain: 'AI',
      limit: 5,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[1].text).toContain('竞品A');
  });
});

// ============================================================
// classifyError & sanitize
// ============================================================
describe('classifyError & sanitize', () => {
  it('sanitize 应屏蔽 OpenAI API key', () => {
    expect(sanitize('key=sk-1234567890abcdefghij')).toContain('[REDACTED_API_KEY]');
  });

  it('sanitize 应屏蔽 URL 中的 api_key 参数', () => {
    expect(sanitize('https://x.com?api_key=abc1234567890xyz')).toContain(
      'api_key=[REDACTED]',
    );
  });

  it('classifyError 应将 401 归为 E_LLM_AUTH', () => {
    const err = classifyError(new Error('HTTP 401 unauthorized'));
    expect(err.kind).toBe('E_LLM_AUTH');
  });

  it('classifyError 应将 fetch failed 归为 E_SEARCH_NETWORK', () => {
    const err = classifyError(new Error('fetch failed ECONNREFUSED'));
    expect(err.kind).toBe('E_SEARCH_NETWORK');
  });

  it('classifyError 应将 SQLITE 错误归为 E_DB_*', () => {
    const writeErr = classifyError(new Error('SQLITE_CONSTRAINT: insert failed'));
    expect(writeErr.kind).toBe('E_DB_WRITE');
    const readErr = classifyError(new Error('SQLITE_READONLY: select failed'));
    expect(readErr.kind).toBe('E_DB_READ');
  });

  it('classifyError 应将未知错误归为 E_INTERNAL', () => {
    const err = classifyError(new Error('something weird'));
    expect(err.kind).toBe('E_INTERNAL');
  });

  it('errorToMcpContent 应输出 2 个 content 块', () => {
    const err = new McpToolError('E_LLM_AUTH', 'invalid key', { context: { provider: 'd' } });
    const content = errorToMcpContent(err);
    expect(content.length).toBe(2);
    expect(content[0].type).toBe('text');
    expect(content[1].text).toContain('E_LLM_AUTH');
  });

  it('ERROR_KINDS 应包含所有错误码', () => {
    expect(ERROR_KINDS.length).toBeGreaterThanOrEqual(10);
    expect(ERROR_KINDS).toContain('E_LLM_RATE_LIMIT');
    expect(ERROR_KINDS).toContain('E_DB_NOT_READY');
  });
});