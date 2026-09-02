/**
 * search/sourceWeights.ts 单元测试
 *
 * 覆盖:
 *   - 默认映射 (默认表覆盖所有内置 source)
 *   - v1.7 中文源默认 weight/type
 *   - 环境变量 INSIGHTFORGE_SOURCE_WEIGHTS 覆盖
 *   - 非法权重 / 空字符串 / 未知 source 兜底
 *   - _resetSourceWeightsForTest 缓存清理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getSourceConfig,
  getDisabledSourceNotes,
  DISABLED_SOURCES,
  _resetSourceWeightsForTest,
} from '../src/services/search/sourceWeights.js';

beforeEach(() => {
  delete process.env.INSIGHTFORGE_SOURCE_WEIGHTS;
  _resetSourceWeightsForTest();
});

describe('sourceWeights - 默认映射', () => {
  it('内置默认 source 含 v1.7 中文源', () => {
    expect(getSourceConfig('reddit')).toEqual({ weight: 1.0, type: 'social' });
    expect(getSourceConfig('hackernews')).toEqual({ weight: 1.2, type: 'forum' });
    expect(getSourceConfig('google')).toEqual({ weight: 1.0, type: 'search' });
    expect(getSourceConfig('bing')).toEqual({ weight: 0.9, type: 'search' });
    expect(getSourceConfig('producthunt')).toEqual({ weight: 1.1, type: 'review' });
    expect(getSourceConfig('zhihu')).toEqual({ weight: 1.1, type: 'forum' });
    expect(getSourceConfig('juejin')).toEqual({ weight: 1.0, type: 'forum' });
    expect(getSourceConfig('weibo')).toEqual({ weight: 0.8, type: 'social' });
    expect(getSourceConfig('xiaohongshu')).toEqual({ weight: 0.8, type: 'social' });
  });

  it('未知 source 返回 fallback (weight=1.0, type=search)', () => {
    expect(getSourceConfig('not-exist-xxx')).toEqual({ weight: 1.0, type: 'search' });
    expect(getSourceConfig('')).toEqual({ weight: 1.0, type: 'search' });
  });
});

describe('sourceWeights - 骨架源不变量', () => {
  it('DISABLED_SOURCES 当前包含 weibo + xiaohongshu(v1.7 决策)', () => {
    // 本断言是 v1.7 决策的 build 期硬依赖:
    //   若未来启用了某个骨架源(例如接 cookie),必须同步更新本列表 + DEFAULT_WEIGHTS 表。
    expect(DISABLED_SOURCES).toEqual(['weibo', 'xiaohongshu']);
  });

  it('getDisabledSourceNotes 返回同一份只读名单(冻结引用)', () => {
    const a = getDisabledSourceNotes();
    const b = getDisabledSourceNotes();
    expect(a).toBe(b); // 引用一致 — 避免上层误改源列表
    expect(a).toContain('weibo');
    expect(a).toContain('xiaohongshu');
  });

  it('骨架源仍能在 DEFAULT_WEIGHTS 中查到权重(为将来启用预占位)', () => {
    // 即便骨架源拉不到数据,它在权重表中也有默认 weight + type,
    // 实装后贡献度计算无需临时加分支。
    expect(getSourceConfig('weibo').weight).toBe(0.8);
    expect(getSourceConfig('xiaohongshu').weight).toBe(0.8);
    expect(getSourceConfig('weibo').type).toBe('social');
    expect(getSourceConfig('xiaohongshu').type).toBe('social');
  });
});

describe('sourceWeights - 环境变量覆盖', () => {
  it('INSIGHTFORGE_SOURCE_WEIGHTS 命中已知 source', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = 'zhihu=1.8,hackernews=2.5';
    _resetSourceWeightsForTest();
    expect(getSourceConfig('zhihu').weight).toBe(1.8);
    // type 字段保持默认值 'forum'
    expect(getSourceConfig('zhihu').type).toBe('forum');
    expect(getSourceConfig('hackernews').weight).toBe(2.5);
  });

  it('环境变量只覆盖 weight,不影响默认 type', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = 'reddit=5';
    _resetSourceWeightsForTest();
    expect(getSourceConfig('reddit').weight).toBe(5);
    expect(getSourceConfig('reddit').type).toBe('social');
  });

  it('非法权重被忽略,不影响其他 source', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = 'zhihu=-1,juejin=abc,hackernews=1.5';
    _resetSourceWeightsForTest();
    // 非法值跳过:仍用默认
    expect(getSourceConfig('zhihu').weight).toBe(1.1);
    expect(getSourceConfig('juejin').weight).toBe(1.0);
    expect(getSourceConfig('hackernews').weight).toBe(1.5);
  });

  it('空环境变量等于无覆盖', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = '   ';
    _resetSourceWeightsForTest();
    expect(getSourceConfig('zhihu').weight).toBe(1.1);
  });

  it('未知 source 在 env 中给出自定义 weight 时,使用 FALLBACK type', () => {
    process.env.INSIGHTFORGE_SOURCE_WEIGHTS = 'my-source=2.0';
    _resetSourceWeightsForTest();
    expect(getSourceConfig('my-source').weight).toBe(2.0);
    expect(getSourceConfig('my-source').type).toBe('search');
  });
});
