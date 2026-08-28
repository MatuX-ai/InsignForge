/**
 * InsightForge dsh 插件 - Client 入口 —— 文档 2.2 / 4.4 节 / v0.3.0
 *
 * 注册 dsh Web UI 的扩展点(浏览器侧加载):
 * - slash command `/research <idea>`:快速触发调研
 * - 消息输入框旁的"快速调研"按钮:一键调起 market_research 工具
 * - 报告预览面板:展示 7 章节市场报告
 *
 * 本文件由 esbuild 打包为 IIFE 格式(dist/client.js),挂在 window.insightforgeClient。
 */
import type { Context } from '@deepseek-ai/cordis';

export const name = 'insightforge-client';
export const inject = ['shell', 'tools'];

/** UI 扩展点定义(在 dsh shell 中注册) */
export interface InsightForgeUIAction {
  /** 命令面板中的标签 */
  label: string;
  /** 触发场景提示 */
  hint: string;
  /** 实际调用 */
  onExecute: (args: { idea: string }) => Promise<void>;
}

const QUICK_RESEARCH: InsightForgeUIAction = {
  label: '快速市场调研',
  hint: '基于你的想法生成 7 章节市场验证报告',
  onExecute: async ({ idea }) => {
    if (!idea || idea.trim().length < 3) {
      throw new Error('请提供至少 3 个字符的产品想法');
    }
    // 实际执行由 dsh shell 注入 tools 后转发到 host
    const tools = (globalThis as unknown as { __dshTools__?: { invoke?: (name: string, args: unknown) => Promise<unknown> } }).__dshTools__;
    if (!tools?.invoke) {
      console.warn('[insightforge-client] __dshTools__.invoke 不可用,降级为 console 输出');
      return;
    }
    const result = await tools.invoke('market_research', { idea, depth: 'standard' });
    renderReport(result);
  },
};

const GENERATE_LANDING: InsightForgeUIAction = {
  label: '生成落地页',
  hint: '为这个想法生成验证落地页 HTML',
  onExecute: async ({ idea }) => {
    const tools = (globalThis as unknown as { __dshTools__?: { invoke?: (name: string, args: unknown) => Promise<unknown> } }).__dshTools__;
    if (!tools?.invoke) {
      console.warn('[insightforge-client] __dshTools__.invoke 不可用');
      return;
    }
    const result = (await tools.invoke('generate_landing', {
      idea,
      value_proposition: `一个面向 ${idea} 的创新解决方案,正在验证市场需求。`,
      theme: 'light',
    })) as { html?: string };
    if (result?.html) {
      openHtmlPreview(result.html);
    }
  },
};

const SEARCH_DEMAND: InsightForgeUIAction = {
  label: '检索需求库',
  hint: '在历史需求库中搜索相关讨论',
  onExecute: async ({ idea }) => {
    const tools = (globalThis as unknown as { __dshTools__?: { invoke?: (name: string, args: unknown) => Promise<unknown> } }).__dshTools__;
    if (!tools?.invoke) {
      console.warn('[insightforge-client] __dshTools__.invoke 不可用');
      return;
    }
    const hits = (await tools.invoke('search_demand', { query: idea, limit: 10 })) as unknown[];
    // 搜索结果 UI 化在 v1.1 迭代,当前仅调试窗口提示条数
    console.warn(`[insightforge-client] search_demand 命中 ${hits.length} 条 (UI 尚未接入)`);
  },
};

/** 应用激活函数 —— 由 esbuild 打包后供 dsh 浏览器侧加载 */
export function apply(ctx: Context): void {
  // 命令面板:slash command
  ctx.shell.command.register({
    name: 'research',
    description: '/research <idea> - 基于想法快速生成市场调研报告',
    handler: async (args: string) => {
      const idea = args.trim();
      await QUICK_RESEARCH.onExecute({ idea });
    },
  });

  // 操作面板:三个按钮
  ctx.shell.action.register({
    id: 'insightforge-quick-research',
    label: QUICK_RESEARCH.label,
    icon: 'search',
    onClick: async () => {
      const idea = window.prompt('请输入产品想法(至少 3 个字符):') ?? '';
      await QUICK_RESEARCH.onExecute({ idea });
    },
  });

  ctx.shell.action.register({
    id: 'insightforge-generate-landing',
    label: GENERATE_LANDING.label,
    icon: 'globe',
    onClick: async () => {
      const idea = window.prompt('请输入产品想法:') ?? '';
      await GENERATE_LANDING.onExecute({ idea });
    },
  });

  ctx.shell.action.register({
    id: 'insightforge-search-demand',
    label: SEARCH_DEMAND.label,
    icon: 'database',
    onClick: async () => {
      const idea = window.prompt('请输入检索关键词:') ?? '';
      await SEARCH_DEMAND.onExecute({ idea });
    },
  });
}

// ============================================================
// UI 辅助函数(浏览器侧)
// ============================================================

/** 简单把 7 章节报告渲染为可读 DOM,挂到 body 末尾 */
function renderReport(result: unknown): void {
  const report = result as {
    summary?: string;
    market_heat?: { heat_score: number; trend: string; search_volume: number };
    competitors?: Array<{ name: string; description: string }>;
    pain_points?: string[];
    market_size?: string;
    risks?: string[];
    opportunities?: string[];
    sources?: Array<{ title: string; url: string }>;
  };

  const root = document.createElement('div');
  root.id = 'insightforge-report-preview';
  root.style.cssText = `
    position: fixed; right: 24px; bottom: 24px; width: 420px; max-height: 80vh;
    overflow: auto; background: #fff; color: #0f172a; border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.25); padding: 20px;
    font-family: system-ui; z-index: 9999;
  `;
  root.innerHTML = `
    <button id="insightforge-close" style="position:absolute;top:8px;right:12px;border:none;background:transparent;font-size:20px;cursor:pointer;">×</button>
    <h2 style="margin-top:0;font-size:1.2rem;">市场调研报告</h2>
    <p style="opacity:0.85;margin-bottom:16px;">${escapeHtml(report.summary ?? '')}</p>
    <div style="margin:12px 0;padding:10px;background:#f1f5f9;border-radius:8px;font-size:0.85rem;">
      <strong>市场热度:</strong> ${report.market_heat?.heat_score ?? '?'}/100 ·
      趋势: ${report.market_heat?.trend ?? '?'} ·
      搜索量: ${report.market_heat?.search_volume?.toLocaleString() ?? '?'}
    </div>
    <h3>竞品识别</h3>
    <ul>${(report.competitors ?? []).map((c) => `<li><strong>${escapeHtml(c.name)}</strong>: ${escapeHtml(c.description)}</li>`).join('')}</ul>
    <h3>用户痛点</h3>
    <ul>${(report.pain_points ?? []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    <h3>市场规模</h3>
    <p>${escapeHtml(report.market_size ?? '')}</p>
    <h3>风险</h3>
    <ul>${(report.risks ?? []).map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    <h3>机会</h3>
    <ul>${(report.opportunities ?? []).map((o) => `<li>${escapeHtml(o)}</li>`).join('')}</ul>
    <h3>数据来源(${report.sources?.length ?? 0} 条)</h3>
    <ol>${(report.sources ?? []).map((s) => `<li><a href="${escapeHtml(s.url)}" target="_blank">${escapeHtml(s.title)}</a></li>`).join('')}</ol>
  `;
  document.body.appendChild(root);
  document.getElementById('insightforge-close')?.addEventListener('click', () => root.remove());
}

/** 在新窗口打开 HTML 预览 */
function openHtmlPreview(html: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // 30s 后回收,避免内存泄漏
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default { name, inject, apply };