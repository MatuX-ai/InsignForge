/**
 * 单元测试 —— Landing Page 生成(generateLanding)
 *
 * 覆盖:
 * - HTML 转义(XSS 防护)
 * - 主题变体(light / dark)
 * - 必填字段回退
 * - 输出结构(LandingPage)
 */
import { describe, it, expect } from 'vitest';
import { generateLanding } from '../src/landing.js';

describe('generateLanding - 基础结构', () => {
  it('返回 LandingPage 对象', () => {
    const r = generateLanding({
      idea: 'AI 任务管理工具',
      value_proposition: '帮你在 30 秒内规划一天',
    });
    expect(r).toHaveProperty('html');
    expect(r).toHaveProperty('size');
    expect(r).toHaveProperty('theme');
    expect(r.size).toBeGreaterThan(0);
    expect(typeof r.html).toBe('string');
    expect(r.theme).toBe('light');
  });

  it('默认主题为 light', () => {
    const r = generateLanding({ idea: 'X', value_proposition: 'Y' });
    expect(r.theme).toBe('light');
  });

  it('size 等于 utf8 字节数', () => {
    const r = generateLanding({
      idea: '中英文 mixed idea',
      value_proposition: '包含中文 & 符号',
    });
    expect(r.size).toBe(Buffer.byteLength(r.html, 'utf8'));
  });
});

describe('generateLanding - 主题', () => {
  it('dark 主题生效', () => {
    const r = generateLanding({
      idea: 'Idea',
      value_proposition: 'VP',
      theme: 'dark',
    });
    expect(r.theme).toBe('dark');
    expect(r.html).toContain('data-theme="dark"');
    expect(r.html).toContain('#0f172a'); // dark bg
  });

  it('light 主题不出现 dark 调色板', () => {
    const r = generateLanding({
      idea: 'Idea',
      value_proposition: 'VP',
      theme: 'light',
    });
    expect(r.html).toContain('data-theme="light"');
    expect(r.html).toContain('#ffffff');
  });
});

describe('generateLanding - 必填字段回退', () => {
  it('idea 空时使用默认占位', () => {
    const r = generateLanding({ idea: '', value_proposition: 'vp' });
    expect(r.html).toContain('验证你的产品想法');
  });

  it('idea 全空白时使用默认占位', () => {
    const r = generateLanding({ idea: '   ', value_proposition: 'vp' });
    expect(r.html).toContain('验证你的产品想法');
  });

  it('value_proposition 空时使用默认', () => {
    const r = generateLanding({ idea: 'Idea', value_proposition: '' });
    expect(r.html).toContain('下一代工具');
  });

  it('call_to_action 缺省时使用"加入等待列表"', () => {
    const r = generateLanding({ idea: 'Idea', value_proposition: 'vp' });
    expect(r.html).toContain('加入等待列表');
  });

  it('call_to_action 自定义生效', () => {
    const r = generateLanding({
      idea: 'Idea',
      value_proposition: 'vp',
      call_to_action: 'Sign me up',
    });
    expect(r.html).toContain('Sign me up');
  });

  it('tagline 可选缺省', () => {
    const r = generateLanding({ idea: 'Idea', value_proposition: 'vp' });
    expect(r.html).not.toContain('class="tagline"');
  });

  it('tagline 传入时渲染', () => {
    const r = generateLanding({
      idea: 'Idea',
      value_proposition: 'vp',
      tagline: 'Now in beta',
    });
    expect(r.html).toContain('Now in beta');
    expect(r.html).toContain('class="tagline"');
  });
});

describe('generateLanding - XSS 转义', () => {
  it('<script> 标签被转义,不会注入可执行脚本', () => {
    const r = generateLanding({
      idea: '<script>alert(1)</script>',
      value_proposition: 'vp',
    });
    expect(r.html).not.toContain('<script>alert(1)</script>');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('HTML 实体符号全部转义', () => {
    const r = generateLanding({
      idea: `<a href="x" onclick="alert(1)">"hi" & 'bye'</a>`,
      value_proposition: 'vp',
    });
    expect(r.html).not.toMatch(/<a\s+href/);
    expect(r.html).toContain('&lt;a');
    expect(r.html).toContain('&quot;');
    expect(r.html).toContain('&amp;');
    expect(r.html).toContain('&#39;');
  });

  it('CTA 中的尖括号/引号被转义', () => {
    const r = generateLanding({
      idea: 'idea',
      value_proposition: 'vp',
      call_to_action: `<img src=x onerror="alert(1)">`,
    });
    expect(r.html).toContain('&lt;img');
    expect(r.html).not.toMatch(/<img[^>]*onerror/);
  });
});

describe('generateLanding - 文档结构', () => {
  it('输出完整 HTML5 文档', () => {
    const r = generateLanding({ idea: 'Idea', value_proposition: 'vp' });
    expect(r.html).toMatch(/^<!DOCTYPE html>/);
    expect(r.html).toContain('<html lang="zh-CN"');
    expect(r.html).toContain('<meta charset="UTF-8">');
    expect(r.html).toContain('<meta name="viewport"');
    expect(r.html).toContain('</html>');
  });

  it('生成日期出现在 footer', () => {
    const r = generateLanding({ idea: 'Idea', value_proposition: 'vp' });
    expect(r.html).toContain(new Date().toISOString().slice(0, 10));
    expect(r.html).toContain('由 InsightForge 生成');
  });

  it('title 标签使用 idea 内容', () => {
    const r = generateLanding({
      idea: '我的产品',
      value_proposition: 'vp',
    });
    expect(r.html).toContain('<title>我的产品 - 验证页面</title>');
  });
});