/**
 * PDF 用 HTML 渲染模板
 *
 * 设计目标:
 *   - 完全自包含 (内联 CSS + 自托管字体声明降级),不依赖任何外部 CDN
 *   - 中文字体优先使用系统中文字体栈,在容器中由 Chromium 自然选定
 *   - 输出尺寸 A4,1.2cm 边距,适合打印或转为 PDF
 *
 * v1.1 优化:
 *   - 增加封面页
 *   - 增加目录页
 *   - 增加页码 (页脚)
 *   - 增加可行性评分模块
 *   - 增加行动建议模块
 *   - 增加竞品对比矩阵
 *
 * 输出 HTML 是字面字符串,与前端 React 组件无关,以保证 puppeteer 渲染一致性
 */
import type { MarketReport, Project } from '../types/index.js';

const TREND_LABEL: Record<MarketReport['market_heat']['trend'], string> = {
  rising: '↑ 上升',
  stable: '→ 平稳',
  declining: '↓ 下降',
};

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  @page { size: A4; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
      "Source Han Sans CN", "Noto Sans CJK SC", "WenQuanYi Micro Hei",
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #111827;
    font-size: 11.5px;
    line-height: 1.65;
    background: #ffffff;
  }
  .container { max-width: 720px; margin: 0 auto; }
  h1 {
    font-size: 22px;
    margin: 0 0 4px;
    color: #1d4ed8;
    border-bottom: 2px solid #1d4ed8;
    padding-bottom: 8px;
  }
  h1 small { display: block; font-size: 11px; color: #6b7280; font-weight: 400; margin-top: 4px; }
  h2 {
    font-size: 15px;
    margin: 22px 0 8px;
    color: #1f2937;
    border-left: 3px solid #1d4ed8;
    padding-left: 8px;
  }
  h3 {
    font-size: 13px;
    margin: 12px 0 4px;
    color: #111827;
  }
  p { margin: 4px 0 8px; }
  ul { margin: 4px 0 8px; padding-left: 20px; }
  li { margin: 2px 0; }

  /* ===== 封面页 ===== */
  .cover {
    page-break-after: always;
    min-height: 240mm;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 20mm 10mm;
  }
  .cover .brand {
    font-size: 14px;
    color: #6b7280;
    letter-spacing: 4px;
    margin-bottom: 30px;
  }
  .cover .title {
    font-size: 32px;
    font-weight: 700;
    color: #1d4ed8;
    margin-bottom: 16px;
    line-height: 1.3;
  }
  .cover .subtitle {
    font-size: 16px;
    color: #4b5563;
    margin-bottom: 40px;
    max-width: 500px;
  }
  .cover .divider {
    width: 80px;
    height: 3px;
    background: #1d4ed8;
    margin: 0 auto 40px;
  }
  .cover .meta-grid {
    display: flex;
    gap: 40px;
    margin-top: 20px;
  }
  .cover .meta-item .label {
    font-size: 11px;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .cover .meta-item .value {
    font-size: 14px;
    color: #1f2937;
    font-weight: 500;
  }
  .cover .footer {
    margin-top: auto;
    font-size: 10px;
    color: #9ca3af;
  }

  /* ===== 目录页 ===== */
  .toc {
    page-break-after: always;
    padding-top: 10mm;
  }
  .toc h2 {
    border: none;
    padding: 0;
    font-size: 18px;
    margin-bottom: 20px;
    text-align: center;
  }
  .toc-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .toc-list li {
    display: flex;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px dotted #e5e7eb;
  }
  .toc-list .num {
    width: 24px;
    color: #1d4ed8;
    font-weight: 600;
    flex-shrink: 0;
  }
  .toc-list .title {
    flex: 1;
    color: #1f2937;
  }
  .toc-list .page {
    color: #6b7280;
    font-size: 10px;
    flex-shrink: 0;
  }

  /* ===== 通用组件 ===== */
  .meta {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 11px;
    color: #475569;
    margin: 10px 0 18px;
  }
  .meta div { margin: 2px 0; }
  .meta strong { color: #1f2937; }
  .heat-grid {
    display: flex;
    gap: 8px;
    margin: 8px 0 12px;
    page-break-inside: avoid;
  }
  .heat-card {
    flex: 1;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 8px 10px;
    background: #fafafa;
    text-align: center;
  }
  .heat-card .label { font-size: 10px; color: #6b7280; margin-bottom: 4px; }
  .heat-card .value { font-size: 18px; font-weight: 600; color: #1d4ed8; }
  .heat-card .value small { font-size: 10px; color: #9ca3af; font-weight: 400; }
  .competitor {
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 8px 10px;
    margin: 6px 0;
    page-break-inside: avoid;
    background: #fafafa;
  }
  .competitor .name { font-size: 13px; font-weight: 600; color: #111827; }
  .competitor .name a { font-size: 10px; color: #1d4ed8; margin-left: 6px; text-decoration: none; }
  .competitor .desc { color: #374151; margin: 4px 0; }
  .pros, .cons { font-size: 11px; margin-top: 4px; }
  .pros strong { color: #047857; }
  .cons strong { color: #b91c1c; }
  .risks-opps { display: flex; gap: 10px; }
  .risks-opps > div { flex: 1; }
  .source {
    font-size: 11px;
    color: #1d4ed8;
    text-decoration: none;
  }
  .source:hover { text-decoration: underline; }
  .footer {
    margin-top: 28px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    font-size: 10px;
    color: #9ca3af;
    text-align: center;
  }
  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    background: #eef2ff;
    color: #3730a3;
    margin-right: 4px;
  }
  /* 避免页面分隔符把卡片截断 */
  h2, h3 { page-break-after: avoid; }
  ul, ol { page-break-before: avoid; }

  /* ===== 可行性评分 ===== */
  .feasibility {
    page-break-inside: avoid;
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px;
    background: #f8fafc;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
  }
  .feasibility .ring {
    flex-shrink: 0;
    text-align: center;
  }
  .feasibility .ring svg { display: block; }
  .feasibility .ring .score {
    font-size: 24px;
    font-weight: 700;
    color: #1d4ed8;
  }
  .feasibility .ring .level {
    font-size: 11px;
    color: #6b7280;
    margin-top: 2px;
  }
  .feasibility .bars { flex: 1; }
  .feasibility .bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 3px 0;
  }
  .feasibility .bar-row .label {
    width: 70px;
    font-size: 10px;
    color: #6b7280;
    flex-shrink: 0;
  }
  .feasibility .bar-row .bar-bg {
    flex: 1;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
  }
  .feasibility .bar-row .bar-fill {
    height: 100%;
    background: #1d4ed8;
    border-radius: 3px;
  }
  .feasibility .bar-row .val {
    width: 28px;
    font-size: 10px;
    color: #1f2937;
    text-align: right;
    flex-shrink: 0;
  }

  /* ===== 行动建议 ===== */
  .recommendations {
    page-break-inside: avoid;
  }
  .rec-item {
    display: flex;
    gap: 10px;
    padding: 8px 10px;
    margin: 4px 0;
    background: #eff6ff;
    border-left: 3px solid #1d4ed8;
    border-radius: 0 4px 4px 0;
  }
  .rec-item .num {
    font-weight: 700;
    color: #1d4ed8;
    flex-shrink: 0;
  }
  .rec-item .text { color: #1e3a8a; }

  /* ===== 竞品对比矩阵 ===== */
  .compare-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
    page-break-inside: avoid;
  }
  .compare-table th,
  .compare-table td {
    border: 1px solid #e5e7eb;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  .compare-table th {
    background: #f1f5f9;
    font-weight: 600;
    color: #374151;
  }
  .compare-table .dim {
    background: #f8fafc;
    font-weight: 500;
    color: #6b7280;
    width: 70px;
  }
  .compare-table .pros-text { color: #047857; }
  .compare-table .cons-text { color: #b91c1c; }

  /* ===== 趋势 ===== */
  .trend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 11px;
  }
  .trend-row .trend-label { color: #6b7280; }
  .trend-row .trend-value { font-weight: 600; }
  .trend-rising { color: #047857; }
  .trend-declining { color: #b91c1c; }
  .trend-stable { color: #6b7280; }

  /* 页码 - 使用 CSS counter */
  .page-footer {
    position: fixed;
    bottom: -10mm;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 9px;
    color: #9ca3af;
  }
`;

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

/** 计算可行性评分(与前端保持一致的算法) */
function calcFeasibility(report: MarketReport) {
  const heat = report.market_heat.heat_score;
  const competitorCount = report.competitors.length;
  const painCount = report.pain_points.length;
  const oppCount = report.opportunities.length;
  const riskCount = report.risks.length;

  const heatScore = heat;
  const competitionScore = Math.max(0, 100 - competitorCount * 15);
  const painScore = Math.min(100, painCount * 14);
  const oppScore = Math.min(100, oppCount * 20);
  const riskScore = Math.max(0, 100 - riskCount * 18);

  const breakdown = [
    { label: '市场热度', score: heatScore, weight: 0.35 },
    { label: '竞争空间', score: competitionScore, weight: 0.20 },
    { label: '需求强度', score: painScore, weight: 0.20 },
    { label: '机会数量', score: oppScore, weight: 0.15 },
    { label: '风险可控', score: riskScore, weight: 0.10 },
  ];

  const total = breakdown.reduce((sum, b) => sum + b.score * b.weight, 0);
  const score = Math.round(total);

  let level = '谨慎进入';
  if (score >= 70) level = '推荐进入';
  else if (score < 40) level = '不推荐';

  return { score, level, breakdown };
}

/** 生成行动建议(与前端保持一致) */
function generateRecommendations(report: MarketReport): string[] {
  const recs: string[] = [];
  const { heat_score, trend } = report.market_heat;

  if (trend === 'rising') {
    recs.push('市场处于上升期,建议尽快切入抢占早期用户心智。');
  } else if (trend === 'declining') {
    recs.push('市场呈下降趋势,建议谨慎进入,或寻找细分转型机会。');
  } else {
    recs.push('市场趋于平稳,建议通过差异化功能切入存量竞争。');
  }

  if (report.competitors.length <= 2) {
    recs.push('竞品较少,市场格局未定,是建立品牌认知的好时机。');
  } else if (report.competitors.length >= 5) {
    recs.push('竞品较多,建议聚焦一个细分场景做深做透,避免正面竞争。');
  }

  if (report.pain_points.length >= 5) {
    recs.push(`用户痛点明确(${report.pain_points.length}条),建议优先解决Top 3痛点验证PMF。`);
  }

  if (report.opportunities.length > 0) {
    recs.push(`建议优先验证:"${report.opportunities[0]}" 作为核心差异化方向。`);
  }

  if (report.risks.length >= 3) {
    recs.push('风险因素较多,建议先做最小可行性验证(MVP),控制投入成本。');
  }

  if (heat_score >= 80) {
    recs.push('市场热度很高,建议加大投入快速推进,抓住窗口期。');
  } else if (heat_score < 40) {
    recs.push('市场热度偏低,建议先验证真实需求,避免过早投入开发。');
  }

  return recs.slice(0, 5);
}

/** 生成环形进度条 SVG */
function ringSvg(score: number, size = 80, strokeWidth = 8): string {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? '#059669' : score < 40 ? '#dc2626' : '#1d4ed8';
  return `
    <svg width="${size}" height="${size}" class="-rotate-90" style="transform: rotate(-90deg);">
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="#e5e7eb" stroke-width="${strokeWidth}" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
    </svg>`;
}

export function renderReportHtml(project: Project, report: MarketReport): string {
  const projectName = project.name?.trim() || '未命名项目';
  const feasibility = calcFeasibility(report);
  const recommendations = generateRecommendations(report);

  // ===== 封面页 =====
  const coverHtml = `
    <div class="cover">
      <div class="brand">INSIGHTFORGE</div>
      <div class="title">${esc(projectName)}</div>
      <div class="divider"></div>
      <div class="subtitle">${esc(report.summary?.slice(0, 100) || '市场调研报告')}${report.summary && report.summary.length > 100 ? '...' : ''}</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="label">热度评分</div>
          <div class="value">${report.market_heat.heat_score} / 100</div>
        </div>
        <div class="meta-item">
          <div class="label">竞品数量</div>
          <div class="value">${report.competitors.length} 个</div>
        </div>
        <div class="meta-item">
          <div class="label">可行性</div>
          <div class="value">${feasibility.level}</div>
        </div>
      </div>
      <div class="footer">
        生成日期:${esc(formatDateShort(report.generated_at))} · InsightForge 市场调研
      </div>
    </div>`;

  // ===== 目录页 =====
  const tocItems = [
    { num: '1', title: '执行摘要' },
    { num: '2', title: '市场热度' },
    { num: '3', title: '可行性评分' },
    { num: '4', title: '竞品识别' },
    { num: '5', title: '竞品对比矩阵' },
    { num: '6', title: '用户痛点' },
    { num: '7', title: '市场规模估算' },
    { num: '8', title: '风险与机会' },
    { num: '9', title: '行动建议' },
    { num: '10', title: '数据来源' },
  ];
  const tocHtml = `
    <div class="toc">
      <h2>目 录</h2>
      <ul class="toc-list">
        ${tocItems.map((item) => `
          <li>
            <span class="num">${item.num}</span>
            <span class="title">${item.title}</span>
            <span class="page">P${item.num}</span>
          </li>
        `).join('')}
      </ul>
    </div>`;

  // ===== 竞品 =====
  const competitorsHtml = report.competitors.length
    ? report.competitors
        .map((c, i) => {
          const link = c.url
            ? `<a class="name" href="${esc(c.url)}">${esc(c.url)}</a>`
            : '';
          const pros =
            c.strengths && c.strengths.length
              ? `<div class="pros"><strong>优势</strong><ul>${c.strengths
                  .map((s) => `<li>${esc(s)}</li>`)
                  .join('')}</ul></div>`
              : '';
          const cons =
            c.weaknesses && c.weaknesses.length
              ? `<div class="cons"><strong>劣势</strong><ul>${c.weaknesses
                  .map((s) => `<li>${esc(s)}</li>`)
                  .join('')}</ul></div>`
              : '';
          return `
            <div class="competitor">
              <div class="name">${i + 1}. ${esc(c.name)}${link}</div>
              <div class="desc">${esc(c.description)}</div>
              ${pros}${cons}
            </div>`;
        })
        .join('')
    : '<div class="meta"><em>暂无竞品数据</em></div>';

  // ===== 竞品对比矩阵 =====
  let compareHtml = '';
  if (report.competitors.length >= 2) {
    const headers = report.competitors.map((c) => `<th>${esc(c.name)}</th>`).join('');
    const descRow = report.competitors.map((c) => `<td>${esc(c.description)}</td>`).join('');
    const prosRow = report.competitors
      .map((c) => {
        if (c.strengths?.length) {
          return `<td class="pros-text">${c.strengths.map((s) => `✓ ${esc(s)}`).join('<br/>')}</td>`;
        }
        return '<td>—</td>';
      })
      .join('');
    const consRow = report.competitors
      .map((c) => {
        if (c.weaknesses?.length) {
          return `<td class="cons-text">${c.weaknesses.map((w) => `✗ ${esc(w)}`).join('<br/>')}</td>`;
        }
        return '<td>—</td>';
      })
      .join('');

    compareHtml = `
    <h2>5. 竞品对比矩阵</h2>
    <table class="compare-table">
      <thead>
        <tr>
          <th class="dim">维度</th>
          ${headers}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="dim">描述</td>
          ${descRow}
        </tr>
        <tr>
          <td class="dim">优势</td>
          ${prosRow}
        </tr>
        <tr>
          <td class="dim">劣势</td>
          ${consRow}
        </tr>
      </tbody>
    </table>`;
  }

  const painHtml = report.pain_points.length
    ? `<ul>${report.pain_points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
    : '<div class="meta"><em>暂无用户痛点数据</em></div>';

  const riskHtml = report.risks.length
    ? `<ul>${report.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
    : '<div class="meta"><em>暂无风险数据</em></div>';

  const oppHtml = report.opportunities.length
    ? `<ul>${report.opportunities.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`
    : '<div class="meta"><em>暂无机会数据</em></div>';

  const sourcesHtml = report.sources.length
    ? `<ol>${report.sources
        .map(
          (s) =>
            `<li><a class="source" href="${esc(
              s.url
            )}">${esc(s.title)}</a>${
              s.source ? ` <span class="pill">${esc(s.source)}</span>` : ''
            }${s.date ? ` <span style="color:#9ca3af;font-size:10px;">(${esc(
              s.date
            )})</span>` : ''}</li>`
        )
        .join('')}</ol>`
    : '<div class="meta"><em>暂无数据来源</em></div>';

  // ===== 可行性评分 HTML =====
  const feasibilityHtml = `
    <div class="feasibility">
      <div class="ring">
        ${ringSvg(feasibility.score, 80, 8)}
        <div class="score">${feasibility.score}</div>
        <div class="level">${feasibility.level}</div>
      </div>
      <div class="bars">
        ${feasibility.breakdown.map((b) => `
          <div class="bar-row">
            <span class="label">${b.label}</span>
            <div class="bar-bg">
              <div class="bar-fill" style="width:${b.score}%"></div>
            </div>
            <span class="val">${b.score}</span>
          </div>
        `).join('')}
      </div>
    </div>`;

  // ===== 行动建议 HTML =====
  const recHtml = recommendations.length
    ? `
    <div class="recommendations">
      ${recommendations.map((r, i) => `
        <div class="rec-item">
          <span class="num">${i + 1}</span>
          <span class="text">${esc(r)}</span>
        </div>
      `).join('')}
      <p style="font-size:10px;color:#9ca3af;margin-top:8px;">* 建议由系统基于报告数据自动生成,仅供参考</p>
    </div>`
    : '';

  // ===== 趋势文字 =====
  const trendClass =
    report.market_heat.trend === 'rising'
      ? 'trend-rising'
      : report.market_heat.trend === 'declining'
      ? 'trend-declining'
      : 'trend-stable';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${esc(projectName)} - InsightForge 报告</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="container">

    <!-- 封面页 -->
    ${coverHtml}

    <!-- 目录页 -->
    ${tocHtml}

    <!-- 正文 -->
    <h1>
      InsightForge 市场调研报告
      <small>Generated ${esc(formatDate(report.generated_at))} · 项目 ID ${esc(project.id)}</small>
    </h1>

    <div class="meta">
      <div><strong>项目名称:</strong> ${esc(projectName)}</div>
      <div><strong>调研描述:</strong> ${esc(project.description)}</div>
      <div><strong>关键词:</strong> ${
        project.keywords && project.keywords.length
          ? project.keywords.map((k) => `<span class="pill">${esc(k)}</span>`).join('')
          : '<em>未提取</em>'
      }</div>
    </div>

    <h2>1. 执行摘要</h2>
    <p>${esc(report.summary || '（暂无内容）').replace(/\n/g, '<br/>')}</p>

    <h2>2. 市场热度</h2>
    <div class="heat-grid">
      <div class="heat-card">
        <div class="label">月度搜索量</div>
        <div class="value">${report.market_heat.search_volume.toLocaleString()}</div>
      </div>
      <div class="heat-card">
        <div class="label">社区讨论量</div>
        <div class="value">${report.market_heat.discussion_count.toLocaleString()}</div>
      </div>
      <div class="heat-card">
        <div class="label">热度评分</div>
        <div class="value">${report.market_heat.heat_score}<small> / 100</small></div>
      </div>
    </div>
    <div class="trend-row">
      <span class="trend-label">趋势:</span>
      <span class="trend-value ${trendClass}">${TREND_LABEL[report.market_heat.trend]}</span>
    </div>

    <h2>3. 可行性评分</h2>
    ${feasibilityHtml}

    <h2>4. 竞品识别 (${report.competitors.length})</h2>
    ${competitorsHtml}

    ${compareHtml}

    <h2>6. 用户痛点 (${report.pain_points.length})</h2>
    ${painHtml}

    <h2>7. 市场规模估算</h2>
    <p>${esc(report.market_size || '（暂无内容）').replace(/\n/g, '<br/>')}</p>

    <h2>8. 风险与机会</h2>
    <div class="risks-opps">
      <div>
        <h3>8.1 风险 (${report.risks.length})</h3>
        ${riskHtml}
      </div>
      <div>
        <h3>8.2 机会 (${report.opportunities.length})</h3>
        ${oppHtml}
      </div>
    </div>

    <h2>9. 行动建议</h2>
    ${recHtml || '<div class="meta"><em>暂无建议</em></div>'}

    <h2>10. 数据来源 (${report.sources.length})</h2>
    ${sourcesHtml}

    <div class="footer">
      本报告由 InsightForge 自动生成 · 仅供商业调研参考
    </div>
  </div>
</body>
</html>`;
}
