/**
 * v1.4 智能化三个服务的单元测试
 *
 * 覆盖:
 *   KeywordExpansionService:
 *     - 正常返回扩展 + 去重 + 大小写不敏感
 *     - LLM 返回原词重复 → 跳过
 *     - LLM 抛出 → 降级返回原 keywords,expanded=false
 *     - schema 校验失败 → 降级
 *     - 空 description / 空 keywords → 直接返回
 *
 *   RerankerService:
 *     - 正常重排 + tail 拼接
 *     - ranked_indices 越界 → 降级 null
 *     - ranked_indices 重复 → 降级 null
 *     - ranked_indices 缺失 → 降级 null
 *     - LLM 抛错 → 降级 null
 *     - 数据 < 3 → 不调用 LLM
 *
 *   PainPointExtractor:
 *     - 正常抽取 + evidence 校验
 *     - evidence 越界过滤 → 全无效的痛点被丢弃
 *     - LLM 抛错 → 降级空数组
 *     - 数据 < 2 → 直接空
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';

// 直接 mock chatJsonWithSchemaRetry(它在 LLMClient.ts 内部调用 chatJson 是模块内调用,
// vi.mock 拦截不到;且本测试只关心服务如何处理 LLM 返回值,不需测 chatJsonWithSchemaRetry 本身)
const { mockChatJsonWithSchemaRetry } = vi.hoisted(() => ({
  mockChatJsonWithSchemaRetry: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/services/llm/LLMClient.js', () => ({
  chatJsonWithSchemaRetry: mockChatJsonWithSchemaRetry,
}));

import { KeywordExpansionService } from '../src/services/KeywordExpansionService.js';
import { RerankerService } from '../src/services/RerankerService.js';
import { PainPointExtractor } from '../src/services/PainPointExtractor.js';

beforeEach(() => {
  mockChatJsonWithSchemaRetry.mockReset();
});

// ----------------------------------------------------------------------------
// KeywordExpansionService
// ----------------------------------------------------------------------------

describe('KeywordExpansionService', () => {
  it('正常返回扩展: 拼接原词 + 新词,大小写不敏感去重', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      keywords: ['长尾词 A', 'LONG TAIL B', '细分场景'],
      reasoning: '增加长尾 + 场景化',
    });

    const out = await KeywordExpansionService.expand('我想做一个工具', ['原词 1', '原词 2']);

    expect(out.expanded).toBe(true);
    expect(out.keywords).toEqual(['原词 1', '原词 2', '长尾词 A', 'LONG TAIL B', '细分场景']);
    expect(out.reasoning).toContain('增加长尾');
    expect(mockChatJsonWithSchemaRetry).toHaveBeenCalledTimes(1);
  });

  it('LLM 返回的原词重复 → 跳过', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      keywords: ['原词 1', '原词 2', '新词 X'],
      reasoning: '重复检测',
    });

    const out = await KeywordExpansionService.expand('主题', ['原词 1', '原词 2']);

    expect(out.keywords).toEqual(['原词 1', '原词 2', '新词 X']);
    expect(out.expanded).toBe(true);
  });

  it('新词之间大小写不敏感去重', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      keywords: ['Long Tail', 'LONG TAIL', 'Long tail'],
      reasoning: '重复',
    });

    const out = await KeywordExpansionService.expand('主题', ['原词']);

    expect(out.keywords).toEqual(['原词', 'Long Tail']);
    expect(out.expanded).toBe(true);
  });

  it('超过 limit 时截断', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      keywords: ['A', 'B', 'C', 'D', 'E'],
      reasoning: 'limit 测试',
    });

    const out = await KeywordExpansionService.expand('主题', ['原词'], { limit: 2 });

    expect(out.keywords).toEqual(['原词', 'A', 'B']);
  });

  it('LLM 抛错 → 降级返回原 keywords,expanded=false', async () => {
    mockChatJsonWithSchemaRetry.mockRejectedValueOnce(new Error('LLM 不可用'));

    const out = await KeywordExpansionService.expand('主题', ['原词 1']);

    expect(out.keywords).toEqual(['原词 1']);
    expect(out.expanded).toBe(false);
    expect(out.reasoning).toContain('LLM 调用失败');
  });

  it('schema 校验失败 → 降级', async () => {
    mockChatJsonWithSchemaRetry.mockRejectedValueOnce(new Error('LLM 输出未通过 schema 校验'));

    const out = await KeywordExpansionService.expand('主题', ['原词']);

    expect(out.keywords).toEqual(['原词']);
    expect(out.expanded).toBe(false);
  });

  it('空 description → 直接返回原 keywords,不调 LLM', async () => {
    const out = await KeywordExpansionService.expand('', ['原词']);
    expect(out.keywords).toEqual(['原词']);
    expect(out.expanded).toBe(false);
    expect(mockChatJsonWithSchemaRetry).not.toHaveBeenCalled();
  });

  it('空 keywords 数组 → 直接返回,不调 LLM', async () => {
    const out = await KeywordExpansionService.expand('主题', []);
    expect(out.keywords).toEqual([]);
    expect(out.expanded).toBe(false);
    expect(mockChatJsonWithSchemaRetry).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// RerankerService
// ----------------------------------------------------------------------------

describe('RerankerService', () => {
  const sample = [
    { title: 'A', content: 'content A', source: 'reddit', url: 'https://a/1' },
    { title: 'B', content: 'content B', source: 'hackernews', url: 'https://b/2' },
    { title: 'C', content: 'content C', source: 'google', url: 'https://c/3' },
    { title: 'D', content: 'content D', source: 'reddit', url: 'https://d/4' },
    { title: 'E', content: 'content E', source: 'reddit', url: 'https://e/5' },
  ];

  it('正常重排: 只重排 topN,tail 按原序拼接', async () => {
    // 5 个条目,topN=3 → 只对 [0,1,2] 重排;返回 [2,0,1] + [3,4] 拼接 = [2,0,1,3,4]
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      ranked_indices: [2, 0, 1],
      reasoning: 'C 主题最相关',
    });

    const out = await RerankerService.rerank('主题', sample, { topN: 3 });

    expect(out).not.toBeNull();
    expect(out!.indices).toEqual([2, 0, 1, 3, 4]);
    expect(out!.reasoning).toContain('C 主题最相关');
    expect(out!.indices.map((i) => sample[i]!.title)).toEqual(['C', 'A', 'B', 'D', 'E']);
  });

  it('全部重排(条数 <= topN)', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      ranked_indices: [1, 0, 2],
      reasoning: 'all rerank',
    });

    const out = await RerankerService.rerank('主题', sample.slice(0, 3), { topN: 20 });

    expect(out!.indices).toEqual([1, 0, 2]);
  });

  it('ranked_indices 越界 → 降级 null', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      ranked_indices: [0, 1, 99], // 越界
      reasoning: '越界',
    });

    const out = await RerankerService.rerank('主题', sample.slice(0, 3), { topN: 3 });

    expect(out).toBeNull();
  });

  it('ranked_indices 重复 → 降级 null', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      ranked_indices: [0, 1, 0], // 0 重复
      reasoning: '重复',
    });

    const out = await RerankerService.rerank('主题', sample.slice(0, 3), { topN: 3 });

    expect(out).toBeNull();
  });

  it('ranked_indices 缺失 → 降级 null', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      ranked_indices: [0, 1], // 缺 2
      reasoning: '缺失',
    });

    const out = await RerankerService.rerank('主题', sample.slice(0, 3), { topN: 3 });

    expect(out).toBeNull();
  });

  it('LLM 抛错 → 降级 null', async () => {
    mockChatJsonWithSchemaRetry.mockRejectedValueOnce(new Error('LLM 502'));

    const out = await RerankerService.rerank('主题', sample);

    expect(out).toBeNull();
  });

  it('数据 < 3 → 不调用 LLM,直接 null', async () => {
    const out = await RerankerService.rerank('主题', sample.slice(0, 2));

    expect(out).toBeNull();
    expect(mockChatJsonWithSchemaRetry).not.toHaveBeenCalled();
  });

  it('空 description → 不调用 LLM,直接 null', async () => {
    const out = await RerankerService.rerank('', sample);

    expect(out).toBeNull();
    expect(mockChatJsonWithSchemaRetry).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// PainPointExtractor
// ----------------------------------------------------------------------------

describe('PainPointExtractor', () => {
  const sample = [
    { title: 'tool A', content: 'expensive and slow', source: 'reddit' },
    { title: 'tool B', content: 'hard to learn', source: 'hackernews' },
    { title: 'tool C', content: 'good but expensive', source: 'google' },
    { title: 'tool D', content: 'lacks personalization', source: 'reddit' },
  ];

  it('正常抽取: 过滤无效 evidence', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      pain_points: [
        { text: '价格过高', intensity: 'high', evidence: [0, 2] },
        { text: '学习成本高', intensity: 'mid', evidence: [1] },
        { text: '个性化不足', intensity: 'low', evidence: [99] }, // 越界 → 整条丢
      ],
      summary: '主要痛点:价格 + 学习曲线',
    });

    const out = await PainPointExtractor.extract('主题', sample);

    expect(out.painPoints).toHaveLength(2);
    expect(out.painPoints[0]).toEqual({
      text: '价格过高',
      intensity: 'high',
      evidence: [0, 2],
    });
    expect(out.painPoints[1]).toEqual({
      text: '学习成本高',
      intensity: 'mid',
      evidence: [1],
    });
    expect(out.summary).toContain('价格');
  });

  it('evidence 全部越界的痛点被丢弃', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      pain_points: [
        { text: 'a', intensity: 'high', evidence: [99, 100] },
        { text: 'b', intensity: 'mid', evidence: [0] },
      ],
      summary: 'test',
    });

    const out = await PainPointExtractor.extract('主题', sample);

    expect(out.painPoints).toHaveLength(1);
    expect(out.painPoints[0]!.text).toBe('b');
  });

  it('LLM 抛错 → 降级空数组', async () => {
    mockChatJsonWithSchemaRetry.mockRejectedValueOnce(new Error('LLM timeout'));

    const out = await PainPointExtractor.extract('主题', sample);

    expect(out.painPoints).toEqual([]);
    expect(out.summary).toContain('失败');
  });

  it('数据 < 2 → 直接空,不调 LLM', async () => {
    const out = await PainPointExtractor.extract('主题', [sample[0]!]);

    expect(out.painPoints).toEqual([]);
    expect(out.summary).toContain('不足');
    expect(mockChatJsonWithSchemaRetry).not.toHaveBeenCalled();
  });

  it('空 description → 直接空,不调 LLM', async () => {
    const out = await PainPointExtractor.extract('', sample);

    expect(out.painPoints).toEqual([]);
    expect(out.summary).toContain('缺少');
    expect(mockChatJsonWithSchemaRetry).not.toHaveBeenCalled();
  });

  it('text 包含首尾空白 → 自动 trim', async () => {
    mockChatJsonWithSchemaRetry.mockResolvedValueOnce({
      pain_points: [{ text: '  价格  ', intensity: 'high', evidence: [0] }],
      summary: 'trim test',
    });

    const out = await PainPointExtractor.extract('主题', sample);

    expect(out.painPoints[0]!.text).toBe('价格');
  });
});
