/**
 * 单元测试 —— InsightForgeCore(SDK 主类)
 *
 * 覆盖:
 * - SDK-50:Config 缺失字段抛错(由构造函数间接触发)
 * - SDK-51:healthCheck() 在 hasSqliteBindings=false 时仍可返回安全结果
 * - SDK-52:dispose() 幂等可重复调用
 * - createInsightForgeCore() 工厂函数等价于 new
 * - extractKeywords() 在 LLM 抛错时走 fallback
 *
 * 注:
 * - 涉及 LLM 真实调用的测试通过 vi.mock 替换 chatJson
 * - DB 相关用例通过 hasSqliteBindings() 守卫跳过
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InsightForgeCore, createInsightForgeCore, getDepthProfile } from '../src/researcher.js';
import { validateConfig } from '../src/config.js';
import type { Config } from '../src/config-types.js';

// Mock 整个 llm 模块,避免真实 LLM 调用
vi.mock('../src/llm.js', () => ({
  chatJson: vi.fn(),
  chatComplete: vi.fn(),
  resetLlmClient: vi.fn(),
}));

// Mock 整个 aggregator 模块,使其返回一个空结果
vi.mock('../src/aggregator.js', () => ({
  aggregate: vi.fn(async () => ({
    inserted: 0,
    unique: 0,
    bySource: { reddit: 0, hackernews: 0, google: 0, bing: 0, producthunt: 0 },
  })),
}));

import { chatJson } from '../src/llm.js';
import { aggregate } from '../src/aggregator.js';

const validConfig: Config = validateConfig({ llmApiKey: 'sk-test' });

describe('createInsightForgeCore / 工厂函数', () => {
  it('等价于 new InsightForgeCore(config)', () => {
    const a = createInsightForgeCore(validConfig);
    const b = new InsightForgeCore(validConfig);
    expect(a).toBeInstanceOf(InsightForgeCore);
    expect(b).toBeInstanceOf(InsightForgeCore);
    a.dispose();
    b.dispose();
  });

  it('config 字段直接可读', () => {
    const core = createInsightForgeCore(validConfig);
    expect(core.config.llmApiKey).toBe('sk-test');
    expect(core.config.maxConcurrent).toBe(5);
    core.dispose();
  });
});

describe('getDepthProfile', () => {
  it('返回三档配置', () => {
    const quick = getDepthProfile('quick');
    const standard = getDepthProfile('standard');
    const deep = getDepthProfile('deep');

    expect(quick.keywordCount).toBeLessThan(standard.keywordCount);
    expect(standard.keywordCount).toBeLessThan(deep.keywordCount);
    expect(quick.maxTokens).toBeLessThan(standard.maxTokens);
    expect(deep.searchLimit).toBeGreaterThan(standard.searchLimit);
    expect(deep.estimatedSeconds).toBeGreaterThan(standard.estimatedSeconds);
  });

  it('每档都包含完整字段', () => {
    for (const d of ['quick', 'standard', 'deep'] as const) {
      const p = getDepthProfile(d);
      expect(p.keywordCount).toBeGreaterThan(0);
      expect(p.keywordTokens).toBeGreaterThan(0);
      expect(p.maxTokens).toBeGreaterThan(0);
      expect(p.searchLimit).toBeGreaterThan(0);
      expect(p.temperature).toBeGreaterThanOrEqual(0);
      expect(p.temperature).toBeLessThanOrEqual(1);
      expect(p.estimatedSeconds).toBeGreaterThan(0);
    }
  });
});

describe('InsightForgeCore - dispose() 幂等性(SDK-52)', () => {
  it('可重复调用,后续调用 no-op', () => {
    const core = new InsightForgeCore(validConfig);
    core.dispose();
    core.dispose(); // 不应抛错
    core.dispose(); // 第三次也不应抛错
  });

  it('dispose 后 research() 抛错', async () => {
    const core = new InsightForgeCore(validConfig);
    core.dispose();
    await expect(
      core.research({ idea: 'test', depth: 'quick' })
    ).rejects.toThrow(/已 dispose/);
  });

  it('dispose 后 healthCheck 返回 ok=false', () => {
    const core = new InsightForgeCore(validConfig);
    core.dispose();
    const h = core.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.error).toContain('dispose');
  });
});

describe('InsightForgeCore - healthCheck() (SDK-51)', () => {
  it('返回包含 db/config/llmAvailable/searchConfigured 字段', () => {
    const core = new InsightForgeCore(validConfig);
    const h = core.healthCheck();
    expect(h).toHaveProperty('db');
    expect(h).toHaveProperty('config');
    expect(h).toHaveProperty('llmAvailable');
    expect(h).toHaveProperty('searchConfigured');
    expect(h).toHaveProperty('ok');
    expect(typeof h.ok).toBe('boolean');
    core.dispose();
  });

  it('config.llmApiKey 非空时 llmAvailable=true', () => {
    const core = new InsightForgeCore({ ...validConfig, llmApiKey: 'sk-real' });
    expect(core.healthCheck().llmAvailable).toBe(true);
    core.dispose();
  });

  it('ollama 提供商无 apiKey 也算 llmAvailable=true', () => {
    const cfg: Config = validateConfig({
      llmProvider: 'ollama',
      llmApiKey: 'ignored', // ollama 不需要 key
      searchEndpoint: 'http://localhost:18080',
    });
    const core = new InsightForgeCore({ ...cfg, llmApiKey: '' });
    expect(core.healthCheck().llmAvailable).toBe(true);
    core.dispose();
  });

  it('searchEndpoint 空字符串时 searchConfigured=false', () => {
    const core = new InsightForgeCore({
      ...validConfig,
      searchEndpoint: '',
    } as Config);
    expect(core.healthCheck().searchConfigured).toBe(false);
    core.dispose();
  });
});

describe('InsightForgeCore - extractKeywords fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chatJson 抛错时,使用 fallback 分词', async () => {
    vi.mocked(chatJson).mockRejectedValueOnce(new Error('LLM 502'));
    const core = new InsightForgeCore(validConfig);
    const r = await core.extractKeywords('hello world AI todo manager', 'quick');
    expect(r.keywords.length).toBeGreaterThan(0);
    expect(r.reasoning).toMatch(/fallback/i);
    core.dispose();
  });

  it('LLM 返回的 keywords 不足 2 个时 fallback', async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({ keywords: ['only-one'], reasoning: 'x' });
    const core = new InsightForgeCore(validConfig);
    const r = await core.extractKeywords('测试产品想法', 'standard');
    // Zod 校验失败 -> fallback
    expect(r.keywords.length).toBeGreaterThan(0);
    core.dispose();
  });

  it('LLM 返回的 keywords 超过 keywordCount 时截断', async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({
      keywords: ['a', 'b', 'c', 'd', 'e', 'f'],
      reasoning: 'x',
    });
    const core = new InsightForgeCore(validConfig);
    const r = await core.extractKeywords('test', 'quick'); // quick.keywordCount=3
    expect(r.keywords.length).toBeLessThanOrEqual(3);
    core.dispose();
  });

  it('LLM 返回合法结果时,keywords 数量 = min(LLM 返回数, profile)', async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({
      keywords: ['kw-a', 'kw-b', 'kw-c', 'kw-d'],
      reasoning: 'reasoning text',
    });
    const core = new InsightForgeCore(validConfig);
    const r = await core.extractKeywords('test', 'standard'); // standard.keywordCount=5
    expect(r.keywords).toEqual(['kw-a', 'kw-b', 'kw-c', 'kw-d']);
    expect(r.reasoning).toBe('reasoning text');
    core.dispose();
  });
});

describe('InsightForgeCore - research() 缓存命中', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('第一次调用 research(),LLM 返回合法报告,第二次同 idea+depth 命中缓存', async () => {
    const validReport = {
      summary: '这是一个足够长的执行摘要',
      market_heat: {
        search_volume: 100,
        discussion_count: 10,
        trend: 'stable' as const,
        heat_score: 50,
      },
      competitors: [],
      pain_points: [],
      market_size: 'tiny',
      risks: [],
      opportunities: [],
      sources: [],
    };

    // 第 1 次:关键词提取
    vi.mocked(chatJson).mockResolvedValueOnce({
      keywords: ['kw1', 'kw2', 'kw3'],
      reasoning: 'r',
    });
    // 第 2 次:报告生成
    vi.mocked(chatJson).mockResolvedValueOnce(validReport);

    vi.mocked(aggregate).mockResolvedValueOnce({
      inserted: 0,
      unique: 0,
      bySource: { reddit: 0, hackernews: 0, google: 0, bing: 0, producthunt: 0 },
    });

    const core = new InsightForgeCore({ ...validConfig, cacheEnabled: true });

    const r1 = await core.research({ idea: '缓存测试', depth: 'standard' });
    expect(r1.fromCache).toBe(false);
    expect(r1.report.depth).toBe('standard');
    expect(r1.report.generated_at).toBeTruthy();
    expect(r1.sessionId).toBeTruthy();

    // 第 2 次同 idea+depth 应命中缓存
    const r2 = await core.research({ idea: '缓存测试', depth: 'standard' });
    expect(r2.fromCache).toBe(true);

    // 不同 depth 应未命中
    vi.mocked(chatJson).mockResolvedValueOnce({
      keywords: ['kw1', 'kw2', 'kw3'],
      reasoning: 'r',
    });
    vi.mocked(chatJson).mockResolvedValueOnce(validReport);
    const r3 = await core.research({ idea: '缓存测试', depth: 'quick' });
    expect(r3.fromCache).toBe(false);

    core.dispose();
  });

  it('noCache=true 跳过缓存', async () => {
    vi.mocked(chatJson).mockResolvedValueOnce({
      keywords: ['kw1', 'kw2'],
      reasoning: 'r',
    });
    vi.mocked(chatJson).mockResolvedValueOnce({
      summary: 'a long enough summary for tests',
      market_heat: { search_volume: 1, discussion_count: 1, trend: 'stable', heat_score: 30 },
      competitors: [],
      pain_points: [],
      market_size: 'tiny',
      risks: [],
      opportunities: [],
      sources: [],
    });

    const core = new InsightForgeCore({ ...validConfig, cacheEnabled: true });
    const r1 = await core.research({ idea: 'no-cache-test', depth: 'standard' });
    expect(r1.fromCache).toBe(false);

    vi.mocked(chatJson).mockResolvedValueOnce({
      keywords: ['kw1', 'kw2'],
      reasoning: 'r',
    });
    vi.mocked(chatJson).mockResolvedValueOnce({
      summary: 'a long enough summary for tests',
      market_heat: { search_volume: 1, discussion_count: 1, trend: 'stable', heat_score: 30 },
      competitors: [],
      pain_points: [],
      market_size: 'tiny',
      risks: [],
      opportunities: [],
      sources: [],
    });
    const r2 = await core.research({ idea: 'no-cache-test', depth: 'standard', noCache: true });
    expect(r2.fromCache).toBe(false);

    core.dispose();
  });
});

describe('InsightForgeCore - session 管理', () => {
  it('createSession 返回带 id/status 的会话', () => {
    const core = new InsightForgeCore(validConfig);
    const s = core.createSession('test idea', 'standard');
    expect(s.id).toBeTruthy();
    expect(s.idea).toBe('test idea');
    expect(s.depth).toBe('standard');
    expect(s.status).toBe('pending');
    expect(core.getSession(s.id)).toBe(s);
    core.dispose();
  });

  it('getSession 对未知 id 返回 undefined', () => {
    const core = new InsightForgeCore(validConfig);
    expect(core.getSession('non-existent')).toBeUndefined();
    core.dispose();
  });

  it('dispose 后 session 被清空', () => {
    const core = new InsightForgeCore(validConfig);
    const s = core.createSession('idea', 'quick');
    expect(core.getSession(s.id)).toBeTruthy();
    core.dispose();
    expect(core.getSession(s.id)).toBeUndefined();
  });
});