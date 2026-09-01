/**
 * search/dedupe.ts 单元测试
 *
 * 覆盖:
 *   - normalizeUrl: 协议大小写 / www 前缀 / 末尾斜杠 / fragment / utm 参数
 *   - dedupeItems: URL 完全相同时合并,engagement 高者胜出,平局合并 author/content
 *   - 标题指纹: 无 url 时按 title+source 去重
 *   - tokenize: 小写 / 标点 / 停用词 / 纯数字过滤
 *   - jaccardSimilarity: 交并比计算
 *   - dedupeBySimilarTitle: URL 不同但标题高度相似时合并(v1.4)
 */
import { describe, it, expect } from 'vitest';

import {
  normalizeUrl,
  dedupeItems,
  tokenize,
  jaccardSimilarity,
  dedupeBySimilarTitle,
  DEFAULT_TITLE_DEDUPE_THRESHOLD,
} from '../src/services/search/dedupe.js';

describe('normalizeUrl', () => {
  it('去 fragment', () => {
    expect(normalizeUrl('https://Example.com/path#section')).toBe(
      'https://example.com/path'
    );
  });

  it('去末尾斜杠(非根路径)', () => {
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    // 根路径保留
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('去 www 前缀并小写主机', () => {
    expect(normalizeUrl('https://WWW.Example.com/x')).toBe('https://example.com/x');
  });

  it('去 utm_* / fbclid / gclid 等 tracking 参数', () => {
    expect(
      normalizeUrl('https://example.com/a?utm_source=x&id=42&utm_campaign=y&fbclid=z')
    ).toBe('https://example.com/a?id=42');
  });

  it('空 query 不保留 ?', () => {
    expect(normalizeUrl('https://example.com/a?utm_source=x')).toBe('https://example.com/a');
  });

  it('保留非 tracking 参数顺序', () => {
    expect(normalizeUrl('https://example.com/a?b=1&c=2')).toBe(
      'https://example.com/a?b=1&c=2'
    );
  });

  it('null / undefined / 空串 返回 null', () => {
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });

  it('非合法 URL 走 fallback(去 fragment + trailing slash)', () => {
    expect(normalizeUrl('not a url#frag')).toBe('not a url');
    expect(normalizeUrl('plain/path/')).toBe('plain/path');
  });
});

describe('dedupeItems', () => {
  it('同 URL(归一化前不同) 视为同一', () => {
    const items = [
      { url: 'https://Example.com/a?utm_source=x', title: 'A', source: 'google' as const, engagement: 5, author: 'u1', content: 'long long content' },
      { url: 'https://example.com/a', title: 'A2', source: 'google' as const, engagement: 3, author: 'u2', content: 'short' },
    ];
    const out = dedupeItems(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.engagement).toBe(5);
  });

  it('engagement 高者胜出', () => {
    const items = [
      { url: 'https://example.com/x', title: 'T', source: 'google' as const, engagement: 1, author: null, content: '' },
      { url: 'https://example.com/x', title: 'T', source: 'google' as const, engagement: 10, author: null, content: '' },
    ];
    const out = dedupeItems(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.engagement).toBe(10);
  });

  it('平局合并 author(避免空覆盖有值)与较长 content', () => {
    const items = [
      { url: 'https://example.com/x', title: 'T', source: 'google' as const, engagement: 5, author: null, content: 'short' },
      { url: 'https://example.com/x', title: 'T', source: 'google' as const, engagement: 5, author: 'real-author', content: 'longer content here' },
    ];
    const out = dedupeItems(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.author).toBe('real-author');
    expect(out[0]!.content).toBe('longer content here');
  });

  it('不同 URL 保留全部', () => {
    const items = [
      { url: 'https://a.com/1', title: 'A', source: 'google' as const, engagement: 1, author: null, content: '' },
      { url: 'https://a.com/2', title: 'B', source: 'google' as const, engagement: 2, author: null, content: '' },
    ];
    expect(dedupeItems(items)).toHaveLength(2);
  });

  it('无 url 时按 title+source 指纹去重', () => {
    const items = [
      { url: null, title: 'same title', source: 'hackernews' as const, engagement: 1, author: null, content: '' },
      { url: null, title: 'same title', source: 'hackernews' as const, engagement: 2, author: null, content: '' },
      { url: null, title: 'different title', source: 'hackernews' as const, engagement: 3, author: null, content: '' },
    ];
    const out = dedupeItems(items);
    expect(out).toHaveLength(2);
  });

  it('同标题不同 source 不合并', () => {
    const items = [
      { url: null, title: 'same title', source: 'hackernews' as const, engagement: 1, author: null, content: '' },
      { url: null, title: 'same title', source: 'reddit' as const, engagement: 2, author: null, content: '' },
    ];
    expect(dedupeItems(items)).toHaveLength(2);
  });

  it('空数组返回空', () => {
    expect(dedupeItems([])).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// v1.4 标题语义去重
// ----------------------------------------------------------------------------

describe('tokenize', () => {
  it('小写并去除标点', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
  });

  it('过滤停用词(英文)', () => {
    expect(tokenize('This is a test of the system')).toEqual(['test', 'system']);
  });

  it('过滤停用词(中文按字切分)', () => {
    // 中文按单字 unigram 切分(不引入分词词典,简单可解释)
    expect(tokenize('我在使用的是一个工具')).toEqual(['使', '用', '工', '具']);
  });

  it('英文后缀归一化(sses/ies/ing/ed/es/s,启发式不去重复辅音)', () => {
    // released -> releas(启发式不去重复辅音,这是已知设计取舍)
    // running -> runn(同上)
    // added -> add
    // boxes -> box(es 优先于 s)
    expect(tokenize('released running added boxes')).toEqual([
      'releas',
      'runn',
      'add',
      'box',
    ]);
  });

  it('混合中英文 + 标点切分 + 数字过滤', () => {
    // GPT-5 / 中文 / 标点 / 数字都正常处理;纯数字 5 / 2024 被过滤
    expect(tokenize('GPT-5 发布 - 2024')).toEqual(['gpt', '发', '布']);
  });

  it('过滤纯数字 token', () => {
    expect(tokenize('2024 release 42 version')).toEqual(['release', 'version']);
  });

  it('过滤单字符(区分度低)', () => {
    expect(tokenize('a bc def ghi')).toEqual(['bc', 'def', 'ghi']);
  });

  it('null / undefined / 空串 返回 []', () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('jaccardSimilarity', () => {
  it('完全相同 = 1', () => {
    expect(jaccardSimilarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
  });

  it('完全不相交 = 0', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('部分重叠 = 交集/并集', () => {
    // A={a,b,c}, B={b,c,d} -> inter=2, union=4 -> 0.5
    expect(jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
  });

  it('任一为空返回 0', () => {
    expect(jaccardSimilarity([], ['a'])).toBe(0);
    expect(jaccardSimilarity(['a'], [])).toBe(0);
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it('重复 token 在同一侧去重后计算', () => {
    // 实际上集合本身就过滤重复:A={a,b}, B={a,b,c} -> inter=2, union=3 -> 0.6667
    expect(jaccardSimilarity(['a', 'a', 'b'], ['a', 'b', 'c'])).toBeCloseTo(2 / 3, 5);
  });
});

describe('dedupeBySimilarTitle', () => {
  it('URL 不同但标题高度相似 => 合并,engagement 高者胜出', () => {
    const items = [
      { url: 'https://a.com/1', title: 'GPT-5 release announcement', source: 'google' as const, engagement: 5, author: null, content: 'short' },
      { url: 'https://b.com/2', title: 'GPT-5 release announcement today', source: 'hackernews' as const, engagement: 10, author: 'real', content: 'longer content here' },
    ];
    const out = dedupeBySimilarTitle(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.engagement).toBe(10);
    expect(out[0]!.author).toBe('real');
    expect(out[0]!.content).toBe('longer content here');
  });

  it('标题明显不同 => 不合并', () => {
    const items = [
      { url: 'https://a.com/1', title: 'GPT-5 release', source: 'google' as const, engagement: 5, author: null, content: '' },
      { url: 'https://b.com/2', title: 'Best pasta recipes in Italy', source: 'reddit' as const, engagement: 3, author: null, content: '' },
    ];
    expect(dedupeBySimilarTitle(items)).toHaveLength(2);
  });

  it('engagement 高者胜出(同组)', () => {
    // 3 个标题 tokens 集相近(jaccard ≈ 0.75),全应并入同组;engagement=99 胜出
    const items = [
      { url: 'https://a.com/1', title: 'Rust async patterns', source: 'google' as const, engagement: 2, author: null, content: '' },
      { url: 'https://b.com/2', title: 'Rust async patterns guide', source: 'reddit' as const, engagement: 99, author: null, content: '' },
      { url: 'https://c.com/3', title: 'Rust async patterns notes', source: 'hackernews' as const, engagement: 7, author: null, content: '' },
    ];
    const out = dedupeBySimilarTitle(items);
    expect(out).toHaveLength(1);
    expect(out[0]!.engagement).toBe(99);
  });

  it('空标题不参与相似度比较(避免误合并)', () => {
    const items = [
      { url: 'https://a.com/1', title: '', source: 'google' as const, engagement: 1, author: null, content: '' },
      { url: 'https://b.com/2', title: '', source: 'reddit' as const, engagement: 2, author: null, content: '' },
    ];
    expect(dedupeBySimilarTitle(items)).toHaveLength(2);
  });

  it('单 token 标题不参与比较(token 太短区分度低)', () => {
    const items = [
      { url: 'https://a.com/1', title: 'AI', source: 'google' as const, engagement: 1, author: null, content: '' },
      { url: 'https://b.com/2', title: 'AI', source: 'reddit' as const, engagement: 2, author: null, content: '' },
    ];
    expect(dedupeBySimilarTitle(items)).toHaveLength(2);
  });

  it('阈值可调: 阈值 1.0 时只接受完全相同的 token 集', () => {
    const items = [
      { url: 'https://a.com/1', title: 'rust async runtime', source: 'google' as const, engagement: 1, author: null, content: '' },
      { url: 'https://b.com/2', title: 'rust async runtime guide', source: 'reddit' as const, engagement: 2, author: null, content: '' },
    ];
    // 阈值 0.7 默认应合并
    expect(dedupeBySimilarTitle(items)).toHaveLength(1);
    // 阈值 1.0 不合并
    expect(dedupeBySimilarTitle(items, { threshold: 1.0 })).toHaveLength(2);
  });

  it('阈值边界容错(< 0 取 0, > 1 取 1)', () => {
    const items = [
      { url: 'https://a.com/1', title: 'foo bar', source: 'google' as const, engagement: 1, author: null, content: '' },
      { url: 'https://b.com/2', title: 'foo baz', source: 'reddit' as const, engagement: 2, author: null, content: '' },
    ];
    expect(dedupeBySimilarTitle(items, { threshold: -1 })).toHaveLength(1); // 视为 0
    expect(dedupeBySimilarTitle(items, { threshold: 2 })).toHaveLength(2); // 视为 1
  });

  it('中文标题同主题多源报道会合并', () => {
    const items = [
      { url: 'https://news.a/x', title: '拼多多 商家联盟 上线', source: 'google' as const, engagement: 3, author: null, content: '' },
      { url: 'https://news.b/y', title: '拼多多 商家联盟 正式上线', source: 'hackernews' as const, engagement: 8, author: null, content: '' },
      { url: 'https://news.c/z', title: '老房装修 速算 工具', source: 'reddit' as const, engagement: 5, author: null, content: '' },
    ];
    const out = dedupeBySimilarTitle(items);
    // 前两个合并为同主题,第三个独立
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.engagement === 8)).toBeTruthy();
  });

  it('多组同时存在(>2 组)按 union-find 全部正确合并', () => {
    // TS 组:3 个标题 tokens 集接近(jaccard = 3/4 = 0.75),应合为一组;engagement=3 胜出
    // Rust 组:2 个标题 tokens 集接近(jaccard = 4/5 = 0.8),应合为一组;engagement=5 胜出
    const items = [
      { url: 'https://a/1', title: 'TypeScript 6 beta release', source: 'google' as const, engagement: 1, author: null, content: '' },
      { url: 'https://b/2', title: 'TypeScript 6 beta release notes', source: 'hackernews' as const, engagement: 2, author: null, content: '' },
      { url: 'https://c/3', title: 'TypeScript 6 beta release today', source: 'reddit' as const, engagement: 3, author: null, content: '' },
      { url: 'https://d/4', title: 'Rust async patterns guide', source: 'reddit' as const, engagement: 4, author: null, content: '' },
      { url: 'https://e/5', title: 'Rust async patterns guide overview', source: 'google' as const, engagement: 5, author: null, content: '' },
    ];
    const out = dedupeBySimilarTitle(items);
    expect(out).toHaveLength(2);
    // TypeScript 组 => engagement=3 胜出
    expect(out.find((o) => o.title?.includes('TypeScript'))?.engagement).toBe(3);
    // Rust 组 => engagement=5 胜出
    expect(out.find((o) => o.title?.includes('Rust'))?.engagement).toBe(5);
  });

  it('默认阈值常量 = 0.7', () => {
    expect(DEFAULT_TITLE_DEDUPE_THRESHOLD).toBe(0.7);
  });

  it('空数组返回空', () => {
    expect(dedupeBySimilarTitle([])).toEqual([]);
  });
});
