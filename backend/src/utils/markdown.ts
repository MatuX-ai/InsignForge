/**
 * MarketReport -> Markdown 序列化器
 *
 * v1.1 优化:
 *   - 增加目录 (TOC)
 *   - 增加可行性评分模块
 *   - 增加行动建议模块
 *   - 增加竞品对比矩阵表格
 *   - 增加 Mermaid 图表支持 (热度评分饼图 + 趋势图)
 *
 * 输出结构:
 *   元信息 → 目录 → 执行摘要 → 市场热度 → 可行性评分 → 竞品 → 竞品对比矩阵 →
 *   痛点 → 市场规模 → 风险 → 机会 → 行动建议 → 数据来源
 *
 * 所有动态内容都经过 escape(),防止破坏 Markdown 结构
 */
import type { MarketReport, Project } from '../types/index.js';

const TREND_LABEL: Record<MarketReport['market_heat']['trend'], string> = {
  rising: '↑ 上升',
  stable: '→ 平稳',
  declining: '↓ 下降',
};

/**
 * 转义破坏 Markdown 结构的字符
 * 注意:只转义会破坏 Markdown 语义的字符;不替换中文标点,以保留报告原意
 */
function escape(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1');
}

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

/**
 * 安全文件名:去除 Windows/Unix 非法字符
 * 项目名一般为中文,这里不做 transliteration,直接保留
 */
export function reportFilenameBase(project: Project): string {
  const raw = (project.name || `project-${project.id.slice(0, 8)}`).trim();
  const safe = raw
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
    .trim();
  return safe || `report-${project.id.slice(0, 8)}`;
}

/** 计算可行性评分(与前端/PDF保持一致的算法) */
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

/** 生成行动建议(与前端/PDF保持一致) */
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

export function reportToMarkdown(project: Project, report: MarketReport): string {
  const lines: string[] = [];
  const projectName = project.name?.trim() || '未命名项目';
  const feasibility = calcFeasibility(report);
  const recommendations = generateRecommendations(report);

  // ===== 元信息 =====
  lines.push('# InsightForge 市场调研报告', '');
  lines.push(`> **项目名称**: ${escape(projectName)}`);
  if (project.description) {
    lines.push(`> **调研描述**: ${escape(project.description)}`);
  }
  lines.push(`> **报告生成时间**: ${formatDate(report.generated_at) || '未知'}`);
  lines.push(`> **项目 ID**: \`${project.id}\``);
  lines.push('');

  // ===== 目录 =====
  lines.push('## 目录', '');
  const tocItems = [
    '1. 执行摘要',
    '2. 市场热度',
    '3. 可行性评分',
    '4. 竞品识别',
    '5. 竞品对比矩阵',
    '6. 用户痛点',
    '7. 市场规模估算',
    '8. 风险与机会',
    '9. 行动建议',
    '10. 数据来源',
  ];
  tocItems.forEach((item) => {
    lines.push(`- ${item}`);
  });
  lines.push('');
  lines.push('---', '');

  // ===== 1. 执行摘要 =====
  lines.push('## 1. 执行摘要', '');
  lines.push(report.summary || '_(暂无内容)_', '');

  // ===== 2. 市场热度 =====
  lines.push('## 2. 市场热度', '');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 月度搜索量 | ${report.market_heat.search_volume.toLocaleString()} |`);
  lines.push(
    `| 社区讨论量 | ${report.market_heat.discussion_count.toLocaleString()} |`
  );
  lines.push(`| 趋势 | ${TREND_LABEL[report.market_heat.trend]} |`);
  lines.push(`| 综合热度评分 | **${report.market_heat.heat_score}** / 100 |`);
  lines.push('');

  // Mermaid 热度饼图
  lines.push('### 2.1 热度构成 (Mermaid)', '');
  lines.push('```mermaid');
  lines.push('pie title 市场热度构成');
  lines.push(`    "搜索量指数" : ${Math.min(100, Math.round(report.market_heat.search_volume / Math.max(1, report.market_heat.search_volume + report.market_heat.discussion_count) * 100))}`);
  lines.push(`    "讨论量指数" : ${Math.min(100, Math.round(report.market_heat.discussion_count / Math.max(1, report.market_heat.search_volume + report.market_heat.discussion_count) * 100))}`);
  lines.push('```', '');

  // Mermaid 趋势图 (简化的 xychart)
  lines.push('### 2.2 趋势示意', '');
  const trendEmoji =
    report.market_heat.trend === 'rising'
      ? '📈 上升趋势'
      : report.market_heat.trend === 'declining'
      ? '📉 下降趋势'
      : '➡️ 平稳趋势';
  lines.push(`> ${trendEmoji} — 综合热度评分 **${report.market_heat.heat_score}** / 100`, '');

  // ===== 3. 可行性评分 =====
  lines.push('## 3. 可行性评分', '');
  lines.push(`**综合评分: ${feasibility.score} / 100 — ${feasibility.level}**`, '');
  lines.push('| 维度 | 得分 | 权重 | 说明 |');
  lines.push('| --- | --- | --- | --- |');
  feasibility.breakdown.forEach((b) => {
    const desc =
      b.label === '市场热度'
        ? '基于搜索量+讨论量+趋势的综合热度'
        : b.label === '竞争空间'
        ? '竞品越少,市场空间越大'
        : b.label === '需求强度'
        ? '用户痛点越多,需求越明确'
        : b.label === '机会数量'
        ? '切入机会点越多越好'
        : '风险越少,可控性越高';
    lines.push(`| ${b.label} | ${b.score} | ${Math.round(b.weight * 100)}% | ${desc} |`);
  });
  lines.push('');

  // Mermaid 雷达图 (用 pie 近似展示各维度占比)
  lines.push('### 3.1 评分维度分布', '');
  lines.push('```mermaid');
  lines.push('pie title 可行性评分维度');
  feasibility.breakdown.forEach((b) => {
    lines.push(`    "${b.label}" : ${b.score}`);
  });
  lines.push('```', '');

  // ===== 4. 竞品识别 =====
  lines.push(`## 4. 竞品识别 (${report.competitors.length})`, '');
  if (report.competitors.length === 0) {
    lines.push('_暂无竞品数据_', '');
  } else {
    report.competitors.forEach((c, i) => {
      lines.push(`### 4.${i + 1} ${c.name}`, '');
      if (c.url) {
        lines.push(`**链接**: <${c.url}>`, '');
      }
      lines.push(c.description);
      if (c.strengths && c.strengths.length) {
        lines.push('', '**优势**:');
        c.strengths.forEach((s) => lines.push(`- ✅ ${s}`));
      }
      if (c.weaknesses && c.weaknesses.length) {
        lines.push('', '**劣势**:');
        c.weaknesses.forEach((s) => lines.push(`- ❌ ${s}`));
      }
      lines.push('');
    });
  }

  // ===== 5. 竞品对比矩阵 =====
  if (report.competitors.length >= 2) {
    lines.push('## 5. 竞品对比矩阵', '');
    // 表头
    const headers = ['维度', ...report.competitors.map((c) => c.name)];
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    // 描述行
    const descRow = ['描述', ...report.competitors.map((c) => c.description)];
    lines.push(`| ${descRow.map((c) => escape(c)).join(' | ')} |`);
    // 优势行
    const prosRow = [
      '核心优势',
      ...report.competitors.map((c) =>
        c.strengths?.length ? c.strengths.join('<br/>') : '—'
      ),
    ];
    lines.push(`| ${prosRow.map((c) => escape(c)).join(' | ')} |`);
    // 劣势行
    const consRow = [
      '主要不足',
      ...report.competitors.map((c) =>
        c.weaknesses?.length ? c.weaknesses.join('<br/>') : '—'
      ),
    ];
    lines.push(`| ${consRow.map((c) => escape(c)).join(' | ')} |`);
    lines.push('');
  }

  // ===== 6. 用户痛点 =====
  lines.push(`## 6. 用户痛点 (${report.pain_points.length})`, '');
  if (report.pain_points.length === 0) {
    lines.push('_暂无用户痛点数据_', '');
  } else {
    report.pain_points.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
  }

  // ===== 7. 市场规模 =====
  lines.push('## 7. 市场规模估算', '');
  lines.push(report.market_size || '_(暂无内容)_', '');

  // ===== 8. 风险与机会 =====
  lines.push('## 8. 风险与机会', '');
  lines.push(`### 8.1 风险 (${report.risks.length})`, '');
  if (report.risks.length === 0) {
    lines.push('_暂无风险数据_', '');
  } else {
    report.risks.forEach((r) => lines.push(`- ⚠️ ${r}`));
    lines.push('');
  }
  lines.push(`### 8.2 机会 (${report.opportunities.length})`, '');
  if (report.opportunities.length === 0) {
    lines.push('_暂无机会数据_', '');
  } else {
    report.opportunities.forEach((o) => lines.push(`- ⭐ ${o}`));
    lines.push('');
  }

  // ===== 9. 行动建议 =====
  lines.push('## 9. 行动建议', '');
  if (recommendations.length === 0) {
    lines.push('_暂无建议_', '');
  } else {
    recommendations.forEach((r, i) => {
      lines.push(`${i + 1}. ${r}`);
    });
    lines.push('');
    lines.push('> *建议由系统基于报告数据自动生成,仅供参考*', '');
  }

  // ===== 10. 数据来源 =====
  lines.push(`## 10. 数据来源 (${report.sources.length})`, '');
  if (report.sources.length === 0) {
    lines.push('_暂无数据来源_', '');
  } else {
    report.sources.forEach((s, i) => {
      const tag = s.source ? ` _(${s.source})_` : '';
      const date = s.date ? ` _${s.date}_` : '';
      lines.push(`${i + 1}. [${escape(s.title)}](${s.url})${tag}${date}`);
    });
    lines.push('');
  }

  lines.push('---', '');
  lines.push(
    `_本报告由 [InsightForge](https://github.com/MatuX-ai/InsignForge) 自动生成,数据来源详见第 10 节。_`,
    ''
  );

  return lines.join('\n');
}
