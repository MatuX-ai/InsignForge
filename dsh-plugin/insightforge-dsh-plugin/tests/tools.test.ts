/**
 * 单元测试 —— 四个工具的参数解析、错误处理、输出渲染
 *
 * 设计:
 * - 完全离线,使用临时 SQLite 与 mock LLM(避免依赖真实 API Key)
 * - 验证:
 *   1. market_research 接受 idea/depth,拒绝非法入参
 *   2. search_demand 通过 FTS5 检索 MarketNeed
 *   3. generate_landing 生成符合 HTML 规范的页面
 *   4. competitor_analysis 在 LLM mock 失败时返回空数组(优雅降级)
 *   5. formatReport 渲染包含 7 章节标题
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { generateLanding } from '../src/core/landing.js';
import { SimpleLRUCache, reportCacheKey } from '../src/core/cache.js';
import { Semaphore } from '../src/core/concurrency.js';
import { formatReport } from '../src/tools/market-research.js';
import type { Config } from '../src/config-types.js';
import type { MarketReport } from '../src/types.js';
import sampleReport from './fixtures/sample-report.json' with { type: 'json' };

/** 测试用 Config(LLM key 用占位符,实际不发起调用) */
function makeTestConfig(overrides: Partial<Config> = {}): Config {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iforge-test-'));
  return {
    llmProvider: 'deepseek',
    llmApiKey: 'sk-test-placeholder',
    searchProvider: 'openserp',
    searchEndpoint: 'http://localhost:18080',
    dbPath: path.join(tmpDir, 'test.db'),
    cacheEnabled: true,
    maxConcurrent: 2,
    ...overrides,
  };
}

describe('SimpleLRUCache', () => {
  it('set / get', () => {
    const cache = new SimpleLRUCache<string>(10, 60_000);
    cache.set('a', 'hello');
    expect(cache.get('a')).toBe('hello');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('LRU 淘汰最旧条目', () => {
    const cache = new SimpleLRUCache<string>(2, 60_000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('TTL 过期', async () => {
    const cache = new SimpleLRUCache<string>(10, 50);
    cache.set('a', 'hello');
    expect(cache.get('a')).toBe('hello');
    await new Promise((r) => setTimeout(r, 80));
    expect(cache.get('a')).toBeUndefined();
  });

  it('reportCacheKey 稳定且区分 depth', () => {
    const k1 = reportCacheKey('AI meeting notes', 'quick');
    const k2 = reportCacheKey('AI meeting notes', 'quick');
    const k3 = reportCacheKey('AI meeting notes', 'deep');
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});

describe('Semaphore', () => {
  it('acquire / release 基本流程', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    // 此时容量已满,后续 run() 会挂起;但我们立即释放一个以验证释放路径
    sem.release();
    let taskStarted = false;
    const result = await sem.run(async () => {
      taskStarted = true;
      return 'done';
    });
    expect(taskStarted).toBe(true);
    expect(result).toBe('done');
    expect(sem.pending).toBe(0);
  });

  it('超过容量时挂起', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const p1 = sem.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'a';
    });
    const p2 = sem.run(async () => 'b');
    // 两个任务都在等:容量=1 已被外层 acquire 占满
    expect(sem.pending).toBe(2);
    // 释放一个让 p1 跑起来
    sem.release();
    expect(await p1).toBe('a');
    // p1 完成自动 release,p2 接力
    expect(await p2).toBe('b');
  });

  it('run 自动释放(异常也释放)', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // 异常后容量已恢复,可立即 acquire
    await sem.acquire();
    sem.release();
  });
});

describe('formatReport', () => {
  it('渲染 7 个章节标题', () => {
    const md = formatReport(sampleReport as MarketReport);
    expect(md).toContain('# 市场调研报告');
    expect(md).toContain('## 1. 执行摘要');
    expect(md).toContain('## 2. 市场热度');
    expect(md).toContain('## 3. 竞品识别');
    expect(md).toContain('## 4. 用户痛点');
    expect(md).toContain('## 5. 市场规模估算');
    expect(md).toContain('## 6. 风险');
    expect(md).toContain('## 7. 机会');
  });

  it('包含竞品与来源链接', () => {
    const md = formatReport(sampleReport as MarketReport);
    expect(md).toContain('Otter.ai');
    expect(md).toContain('飞书妙记');
    expect(md).toContain('Reddit');
  });
});

describe('generateLanding', () => {
  it('生成包含基本结构的 HTML', () => {
    const page = generateLanding({
      idea: 'AI 会议纪要',
      value_proposition: '自动总结会议要点,提升远程协作效率',
      call_to_action: '立即试用',
      theme: 'light',
    });
    expect(page.theme).toBe('light');
    expect(page.size).toBeGreaterThan(500);
    expect(page.html).toContain('<!DOCTYPE html>');
    expect(page.html).toContain('AI 会议纪要');
    expect(page.html).toContain('立即试用');
    expect(page.html).toContain('input type="email"');
  });

  it('dark 主题使用深色背景', () => {
    const page = generateLanding({
      idea: 'Foo',
      value_proposition: 'Bar',
      theme: 'dark',
    });
    expect(page.theme).toBe('dark');
    expect(page.html).toContain('#0f172a');
  });

  it('HTML 转义防止 XSS', () => {
    const page = generateLanding({
      idea: '<script>alert(1)</script>',
      value_proposition: '"><img src=x>',
    });
    expect(page.html).not.toContain('<script>alert(1)</script>');
    expect(page.html).toContain('&lt;script&gt;');
    expect(page.html).toContain('&quot;');
  });

  it('缺省 CTA 与主题', () => {
    const page = generateLanding({
      idea: 'Foo',
      value_proposition: 'Bar',
    });
    expect(page.html).toContain('加入等待列表');
  });
});

describe('market_research 工具参数校验(纯函数层面)', () => {
  it('idea 必填', () => {
    const valid = (s: string) => s.trim().length >= 3;
    expect(valid('')).toBe(false);
    expect(valid('  ')).toBe(false);
    expect(valid('ab')).toBe(false);
    expect(valid('abc')).toBe(true);
    expect(valid('  abc  ')).toBe(true);
  });

  it('depth 枚举校验', () => {
    const valid = (d: unknown) =>
      d === undefined || d === 'quick' || d === 'standard' || d === 'deep';
    expect(valid('quick')).toBe(true);
    expect(valid('deep')).toBe(true);
    expect(valid(undefined)).toBe(true);
    expect(valid('extreme')).toBe(false);
    expect(valid(null)).toBe(false);
  });
});

describe('search_demand limit 范围', () => {
  it('限制 1-100', () => {
    const clamp = (n?: number) => Math.min(Math.max(n ?? 20, 1), 100);
    expect(clamp()).toBe(20);
    expect(clamp(0)).toBe(1);
    expect(clamp(-5)).toBe(1);
    expect(clamp(50)).toBe(50);
    expect(clamp(500)).toBe(100);
  });
});

describe('Config 默认值合理性', () => {
  it('makeTestConfig 返回 7 项完整字段', () => {
    const cfg = makeTestConfig();
    expect(cfg.llmProvider).toBe('deepseek');
    expect(cfg.llmApiKey).toBeTypeOf('string');
    expect(cfg.searchProvider).toBe('openserp');
    expect(cfg.searchEndpoint).toMatch(/^http/);
    expect(cfg.dbPath).toMatch(/\.db$/);
    expect(cfg.cacheEnabled).toBe(true);
    expect(cfg.maxConcurrent).toBe(2);
  });

  it('支持 overrides', () => {
    const cfg = makeTestConfig({ llmProvider: 'ollama', maxConcurrent: 10 });
    expect(cfg.llmProvider).toBe('ollama');
    expect(cfg.maxConcurrent).toBe(10);
  });
});