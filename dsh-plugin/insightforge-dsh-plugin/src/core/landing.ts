/**
 * 落地页 HTML 生成器(generate_landing 工具核心)
 *
 * 设计:单文件响应式 HTML,内联 CSS,无外部依赖。
 * 可直接通过 file:// 打开或保存为静态文件部署。
 *
 * 安全:
 * - HTML 转义所有用户输入(避免 XSS)
 * - 不包含任何脚本,纯静态(避免 CSP 问题)
 */
import type { LandingPage } from '../types.js';

export interface LandingInput {
  idea: string;
  value_proposition: string;
  call_to_action?: string;
  theme?: 'light' | 'dark';
  /** 可选副标题 */
  tagline?: string;
}

const DEFAULT_CTA = '加入等待列表';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 生成单文件响应式落地页
 */
export function generateLanding(input: LandingInput): LandingPage {
  const theme = input.theme ?? 'light';
  const idea = input.idea?.trim() || '验证你的产品想法';
  const vp = input.value_proposition?.trim() || '我们正在打造下一代工具,帮助你更快验证市场。';
  const cta = (input.call_to_action ?? DEFAULT_CTA).trim();
  const tagline = input.tagline?.trim();

  const html = renderHtml({
    idea,
    vp,
    cta,
    tagline,
    theme,
  });

  return {
    html,
    size: Buffer.byteLength(html, 'utf8'),
    theme,
  };
}

interface RenderVars {
  idea: string;
  vp: string;
  cta: string;
  tagline?: string;
  theme: 'light' | 'dark';
}

function renderHtml(v: RenderVars): string {
  const e = escapeHtml;
  const palette = v.theme === 'dark'
    ? { bg: '#0f172a', fg: '#f1f5f9', accent: '#38bdf8', card: '#1e293b' }
    : { bg: '#ffffff', fg: '#0f172a', accent: '#2563eb', card: '#f8fafc' };

  const taglineHtml = v.tagline
    ? `<p class="tagline">${e(v.tagline)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${v.theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(v.idea)} - 验证页面</title>
<meta name="description" content="${e(v.vp)}">
<style>
  :root {
    --bg: ${palette.bg};
    --fg: ${palette.fg};
    --accent: ${palette.accent};
    --card: ${palette.card};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .hero {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1.5rem;
  }
  .card {
    max-width: 720px;
    width: 100%;
    background: var(--card);
    border-radius: 16px;
    padding: 3rem 2.5rem;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  }
  h1 {
    font-size: 2.5rem;
    margin: 0 0 1rem;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .tagline {
    color: var(--accent);
    font-size: 1.05rem;
    margin: 0 0 1.5rem;
    font-weight: 500;
  }
  .vp {
    font-size: 1.15rem;
    margin: 0 0 2rem;
    opacity: 0.9;
  }
  form {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  input[type="email"] {
    flex: 1 1 280px;
    padding: 0.85rem 1rem;
    border: 1px solid rgba(127,127,127,0.3);
    background: var(--bg);
    color: var(--fg);
    border-radius: 8px;
    font-size: 1rem;
    outline: none;
    transition: border-color 0.2s;
  }
  input[type="email"]:focus { border-color: var(--accent); }
  button {
    padding: 0.85rem 1.5rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.1s, opacity 0.2s;
  }
  button:hover { transform: translateY(-1px); }
  button:active { transform: translateY(0); }
  .meta {
    margin-top: 2rem;
    font-size: 0.85rem;
    opacity: 0.6;
  }
  @media (max-width: 600px) {
    h1 { font-size: 1.85rem; }
    .card { padding: 2rem 1.5rem; }
  }
</style>
</head>
<body>
  <main class="hero">
    <section class="card">
      <h1>${e(v.idea)}</h1>
      ${taglineHtml}
      <p class="vp">${e(v.vp)}</p>
      <form onsubmit="event.preventDefault(); this.querySelector('button').textContent='已加入,感谢!';">
        <input type="email" placeholder="your@email.com" required aria-label="邮箱">
        <button type="submit">${e(v.cta)}</button>
      </form>
      <p class="meta">由 InsightForge 生成 · ${new Date().toISOString().slice(0,10)}</p>
    </section>
  </main>
</body>
</html>`;
}