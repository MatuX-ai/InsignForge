/**
 * 落地页 HTML 生成器(后端版本)
 *
 * 与 packages/core/src/landing.ts 保持一致的设计:
 * - 单文件响应式 HTML,内联 CSS,无外部依赖
 * - 可直接通过 file:// 打开或保存为静态文件部署
 * - 不包含任何脚本,纯静态
 *
 * 注: 后端直接内联实现以避免对 packages/core 的运行时依赖
 * (后端使用 ESM,core 包构建产物路径可能不同)
 *
 * v1.7.1 增强 (FR-14):
 *   - 订阅按钮 CTA 文案与表单字段均可定制,不再固定「加入等待列表」
 *   - 支持多个表单字段:email / phone / text(任意行均可带 label / placeholder)
 *   - 根据 idea / value_proposition 智能推荐默认 CTA 文案
 *   - 成功提示文案可定制(原「已加入,感谢！」)
 */

export type LandingFormFieldType = 'email' | 'phone' | 'text';

export interface LandingFormField {
  /** 字段名(后端表单 name,这里仅作占位) */
  name: string;
  /** 表单类型 */
  type: LandingFormFieldType;
  /** 用户看到的字段标签 */
  label: string;
  /** placeholder 提示文本 */
  placeholder?: string;
  /** 是否必填(影响 HTML required 属性 + aria-required) */
  required: boolean;
}

export interface LandingInput {
  idea: string;
  value_proposition: string;
  /** v1.7.1: 主按钮文案,默认为智能推荐 */
  call_to_action?: string;
  /** v1.7.1: 按钮下方的次级提示文案(可选) */
  call_to_action_subtext?: string;
  /** v1.7.1: 提交成功后的提示,默认为「提交成功,感谢！」 */
  success_message?: string;
  /** v1.7.1: 表单字段列表。默认仅为 email。 */
  form_fields?: LandingFormField[];
  theme?: 'light' | 'dark';
  tagline?: string;
}

export interface LandingPage {
  html: string;
  size: number;
  theme: 'light' | 'dark';
}

const DEFAULT_CTA = '提交';

/**
 * 智能 CTA 文案推荐 - 根据项目 idea / 价值主张的关键词推测最贴切的行动号召。
 *
 * 规则优先级(命中即停):
 *   1. 含「订阅 / 包月 / 月费 / 会员」→「立即订阅」
 *   2. 含「购买 / 购买 / 下单 / 付费」→「立即购买」
 *   3. 含「下载 / 安装 / app」→「下载使用」
 *   4. 含「报名 / 课程 / 学习 / 参加」→「立即报名」
 *   5. 含「试 / 测试 / demo / 体验」→「免费体验」
 *   6. 含「社 / 群 / 交流 / discord / telegram」→「加入社群」
 *   7. 含「预览 / 优先 / early」→「优先体验」
 *   8. 都不匹配 → 「加入等待列表」(兜底,保持向前兼容)
 *
 * 目标是让项目描述发生变化时 CTA 随动,而不需要用户手动改。
 */
export function recommendCta(text: string): string {
  const t = text ?? '';
  if (/订阅|包月|月费|月付|会员|订阅制/i.test(t)) return '立即订阅';
  if (/购买|下单|付费|付款|结算/i.test(t)) return '立即购买';
  if (/下载|安装|demo 应用|app\b|客户端/i.test(t)) return '下载使用';
  if (/报名|课程|学习|参加|培训/i.test(t)) return '立即报名';
  if (/试用|测试|体验|trial|demo/i.test(t)) return '免费体验';
  if (/社群|社区|discord|telegram|交流群/i.test(t)) return '加入社群';
  if (/预览|提前|优先体验|early\s*access/i.test(t)) return '优先体验';
  return '加入等待列表';
}

/** 默认表单字段:仅邮箱 */
const DEFAULT_FORM_FIELDS: LandingFormField[] = [
  {
    name: 'email',
    type: 'email',
    label: '邮箱',
    placeholder: 'your@email.com',
    required: true,
  },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 单个输入框 HTML 渲染。type=email/phone/text 走不同 input 元素。
 * required 时加 aria-required 与 HTML required。
 */
function renderField(f: LandingFormField, e: (s: string) => string): string {
  const inputType = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
  const ariaLabel = e(f.label);
  const placeholder = f.placeholder ? ` placeholder="${e(f.placeholder)}"` : '';
  const required = f.required ? ' required aria-required="true"' : '';
  return `<label class="field">
  <span class="field-label">${ariaLabel}${f.required ? '<span aria-hidden="true">*</span>' : ''}</span>
  <input type="${inputType}" name="${e(f.name)}" aria-label="${ariaLabel}"${placeholder}${required}>
</label>`;
}

export function generateLanding(input: LandingInput): LandingPage {
  const theme = input.theme ?? 'light';
  const idea = input.idea?.trim() || '验证你的产品想法';
  const vp = input.value_proposition?.trim() || '我们正在打造下一代工具,帮助你更快验证市场。';

  // v1.7.1 FR-14: 智能 CTA 与表单字段
  const cta = (input.call_to_action?.trim() || recommendCta(`${idea} ${vp}`)).trim();
  const subtext = input.call_to_action_subtext?.trim();
  const successMsg = input.success_message?.trim() || '提交成功,感谢！';
  const fields = input.form_fields && input.form_fields.length > 0 ? input.form_fields : DEFAULT_FORM_FIELDS;
  const tagline = input.tagline?.trim();

  const html = renderHtml({ idea, vp, cta, subtext, successMsg, fields, tagline, theme });

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
  subtext?: string;
  successMsg: string;
  fields: LandingFormField[];
  tagline?: string;
  theme: 'light' | 'dark';
}

function renderHtml(v: RenderVars): string {
  const e = escapeHtml;
  const palette = v.theme === 'dark'
    ? { bg: '#0f172a', fg: '#f1f5f9', accent: '#38bdf8', card: '#1e293b', border: 'rgba(148,163,184,0.3)' }
    : { bg: '#ffffff', fg: '#0f172a', accent: '#2563eb', card: '#f8fafc', border: 'rgba(15,23,42,0.15)' };

  const taglineHtml = v.tagline
    ? `<p class="tagline">${e(v.tagline)}</p>`
    : '';

  const subtextHtml = v.subtext
    ? `<p class="cta-subtext">${e(v.subtext)}</p>`
    : '';

  const fieldsHtml = v.fields.map((f) => renderField(f, e)).join('\n        ');

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
    --border: ${palette.border};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
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
    flex-direction: column;
    gap: 0.75rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .field-label {
    font-size: 0.85rem;
    font-weight: 500;
    opacity: 0.85;
  }
  .field-label span[aria-hidden] {
    color: #ef4444;
    margin-left: 0.15rem;
  }
  .field input {
    padding: 0.85rem 1rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    border-radius: 8px;
    font-size: 1rem;
    outline: none;
    transition: border-color 0.2s;
  }
  .field input:focus { border-color: var(--accent); }
  button {
    margin-top: 0.5rem;
    padding: 0.95rem 1.5rem;
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
  .cta-subtext {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.65;
    text-align: center;
  }
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
      <form onsubmit="event.preventDefault(); this.querySelector('button').textContent='${e(v.successMsg)}';">
        ${fieldsHtml}
        <button type="submit">${e(v.cta)}</button>
        ${subtextHtml}
      </form>
      <p class="meta">由 InsightForge 生成 · ${new Date().toISOString().slice(0,10)}</p>
    </section>
  </main>
</body>
</html>`;
}
