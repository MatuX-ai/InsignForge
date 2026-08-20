/**
 * 单元测试 —— Zod Schema(MarketReportSchema / KeywordExtractionSchema / ...)
 *
 * 覆盖 SDK-33 / SDK-34:
 * - 合法输入 parse 成功
 * - 关键字段缺失 / 类型错误 parse 失败
 * - safeParse 不抛错
 */
import { describe, it, expect } from 'vitest';
import {
  MarketReportSchema,
  KeywordExtractionSchema,
  CompetitorSchema,
  MarketHeatSchema,
  ReportSourceSchema,
} from '../src/schemas/report.js';

const validReport = {
  summary: '这是一个 10 字以上的执行摘要,用于校验',
  market_heat: {
    search_volume: 12000,
    discussion_count: 340,
    trend: 'rising' as const,
    heat_score: 62,
  },
  competitors: [
    {
      name: 'LiveShare',
      description: '协作工具',
      url: 'https://example.com',
      strengths: ['实时'],
      weaknesses: ['价格高'],
    },
  ],
  pain_points: ['延迟', '协作困难'],
  market_size: '约 5-10 亿元',
  risks: ['巨头已占据'],
  opportunities: ['AI 差异化'],
  sources: [
    { title: 'Reddit discussion', url: 'https://reddit.com/r/x', source: 'reddit' },
  ],
};

describe('MarketReportSchema', () => {
  it('合法输入 parse 成功', () => {
    const r = MarketReportSchema.safeParse(validReport);
    expect(r.success).toBe(true);
  });

  it('summary 短于 10 字抛错', () => {
    const r = MarketReportSchema.safeParse({ ...validReport, summary: '太短' });
    expect(r.success).toBe(false);
  });

  it('market_heat.heat_score 超过 100 抛错', () => {
    const r = MarketReportSchema.safeParse({
      ...validReport,
      market_heat: { ...validReport.market_heat, heat_score: 150 },
    });
    expect(r.success).toBe(false);
  });

  it('market_heat.trend 不在枚举内抛错', () => {
    const r = MarketReportSchema.safeParse({
      ...validReport,
      market_heat: { ...validReport.market_heat, trend: 'explosive' as never },
    });
    expect(r.success).toBe(false);
  });

  it('competitors 超过 20 个抛错', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      name: `c${i}`,
      description: 'x',
    }));
    const r = MarketReportSchema.safeParse({
      ...validReport,
      competitors: tooMany,
    });
    expect(r.success).toBe(false);
  });

  it('pain_points 含空字符串抛错', () => {
    const r = MarketReportSchema.safeParse({
      ...validReport,
      pain_points: ['有效痛点', ''],
    });
    expect(r.success).toBe(false);
  });

  it('sources 缺 url 抛错', () => {
    const r = MarketReportSchema.safeParse({
      ...validReport,
      sources: [{ title: 'no-url' }],
    });
    expect(r.success).toBe(false);
  });

  it('parse 抛错时抛 ZodError', () => {
    expect(() => MarketReportSchema.parse({ ...validReport, summary: 'x' })).toThrow();
  });
});

describe('KeywordExtractionSchema', () => {
  it('合法输入 parse 成功', () => {
    const r = KeywordExtractionSchema.safeParse({
      keywords: ['kw1', 'kw2', 'kw3'],
      reasoning: 'reason',
    });
    expect(r.success).toBe(true);
  });

  it('reasoning 可选', () => {
    const r = KeywordExtractionSchema.safeParse({ keywords: ['a', 'b'] });
    expect(r.success).toBe(true);
  });

  it('keywords 少于 2 个抛错', () => {
    const r = KeywordExtractionSchema.safeParse({ keywords: ['only'] });
    expect(r.success).toBe(false);
  });

  it('keywords 多于 8 个抛错', () => {
    const r = KeywordExtractionSchema.safeParse({
      keywords: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    });
    expect(r.success).toBe(false);
  });

  it('keywords 含空字符串抛错', () => {
    const r = KeywordExtractionSchema.safeParse({ keywords: ['valid', ''] });
    expect(r.success).toBe(false);
  });
});

describe('CompetitorSchema', () => {
  it('最小字段(name/description)即可通过', () => {
    const r = CompetitorSchema.safeParse({ name: 'Foo', description: 'Bar' });
    expect(r.success).toBe(true);
  });

  it('缺 name 抛错', () => {
    const r = CompetitorSchema.safeParse({ description: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('MarketHeatSchema', () => {
  it('trend 必须为 rising/stable/declining', () => {
    expect(
      MarketHeatSchema.safeParse({
        search_volume: 1,
        discussion_count: 1,
        trend: 'rising',
        heat_score: 50,
      }).success
    ).toBe(true);
    expect(
      MarketHeatSchema.safeParse({
        search_volume: 1,
        discussion_count: 1,
        trend: 'unknown' as never,
        heat_score: 50,
      }).success
    ).toBe(false);
  });
});

describe('ReportSourceSchema', () => {
  it('title/url 必填', () => {
    expect(
      ReportSourceSchema.safeParse({ title: 't', url: 'https://x.com' }).success
    ).toBe(true);
    expect(ReportSourceSchema.safeParse({ title: 't' }).success).toBe(false);
    expect(ReportSourceSchema.safeParse({ url: 'https://x.com' }).success).toBe(false);
  });
});