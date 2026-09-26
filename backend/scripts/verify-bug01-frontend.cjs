/**
 * BUG-01 修复验证 (V3):
 * 使用已存在失败 execution (error_code=MISSING_API_KEY) 的项目,
 * 让前端轮询 /status,确认 LlmSetupPrompt 弹窗自动弹出。
 */
const puppeteer = require('puppeteer-core');
const path = require('node:path');
const fs = require('node:fs');

const BACKEND = 'http://127.0.0.1:64744';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'tests', 'ux-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const TARGET_PROJECT_ID = process.env.TARGET_PROJECT_ID || '4df0b71e-14bd-422d-9148-e49b9f88fb9f';

function shot(page, name) {
  return page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

async function findChrome() {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome 或 Edge');
}

(async () => {
  console.log('======= BUG-01 修复验证 V3 (前端弹窗) =======\n');
  console.log('目标项目:', TARGET_PROJECT_ID);

  const browser = await puppeteer.launch({
    executablePath: await findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // 1. 打开首页
  console.log('\n[1] 打开桌面端首页...');
  await page.goto(`${BACKEND}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await shot(page, 'bug01-fix-v3-01-home');

  // 2. 关掉 OnboardingModal(只在第一次显示)
  console.log('[2] 关闭 OnboardingModal...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const skip = buttons.find((b) => /先跳过|稍后再说/.test(b.textContent || ''));
    if (skip) skip.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'bug01-fix-v3-02-after-skip');

  // 3. 跳转到 Home 页面触发 useResearch 的 trigger,然后等待 failed
  console.log('[3] 在 Home 页触发新调研(无 API Key)...');
  // 用 evaluate 调用后端 trigger,然后切回前端监控
  const triggerResult = await page.evaluate(async (pid) => {
    const r = await fetch(`http://127.0.0.1:64744/api/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'V3-验证', description: 'V3 弹窗验证' }),
    });
    return await r.json();
  });
  const newProjectId = triggerResult.data.id;
  console.log('    新项目 ID:', newProjectId);

  // 触发调研
  await page.evaluate(async (pid) => {
    await fetch(`http://127.0.0.1:64744/api/v1/projects/${pid}/research`, { method: 'POST' });
  }, newProjectId);

  // 4. 跳到项目 research 页(Home 会进入 trigger 路径)
  console.log('[4] 跳转到项目页,让前端轮询...');
  await page.goto(`${BACKEND}/projects/${newProjectId}/research`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  // 5. 在页面直接触发 (模拟用户在 Home 输入并点击调研)
  // 因为首页才是 useResearch 的 owner,我们在项目页不能直接 trigger
  // 改用直接注入 setErrorCode 逻辑到 useResearch hook 不现实
  // 改方案: 在 Home 页填入文字 + 点击"开始研究"按钮
  console.log('[5] 回首页填入文字并点击调研...');
  await page.goto(`${BACKEND}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));

  // 关闭 OnboardingModal(再次访问首页可能重弹,因为 dismissed 是 localStorage)
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const skip = buttons.find((b) => /先跳过|稍后再说/.test(b.textContent || ''));
    if (skip) skip.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // 找到 textarea 填入内容
  const filled = await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '触发 BUG-01 弹窗测试');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  console.log('    文本框填充:', filled ? '✅' : '❌');

  // 点击"马上验证想法"按钮(Home 主 CTA)
  const clickResult = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const candidates = [
      '马上验证想法', '开始调研', '开始研究', '启动调研', 'Start', 'Generate', 'Research',
    ];
    for (const c of candidates) {
      const btn = buttons.find((b) => new RegExp(c).test(b.textContent || ''));
      if (btn && !btn.disabled) {
        btn.click();
        return { found: c, label: btn.textContent?.trim(), disabled: btn.disabled };
      }
    }
    return { found: null, all_buttons: buttons.map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 10) };
  });
  console.log('    按钮点击:', clickResult);

  // 6. 等待前端轮询并显示弹窗(LLM 阶段失败需要网络重试,通常 30~90s)
  console.log('[6] 等待前端轮询 + LlmSetupPrompt 弹窗...');
  let success = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const probe = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return {
        has_llm_setup_prompt: /未配置大模型 API Key/.test(text),
        body_excerpt: text.slice(0, 400),
      };
    });
    if (probe.has_llm_setup_prompt) {
      success = true;
      console.log(`  ✅ 第 ${(i + 1) * 3}s 检测到 LlmSetupPrompt 弹窗`);
      break;
    }
    // 检查 status 是否 failed (这样能提前结束)
    const s = await api('GET', `/api/v1/projects/${newProjectId}/research/status`).catch(() => null);
    if (s && s.json?.data?.execution?.status === 'failed') {
      console.log(`  调研已 failed(${s.json.data.execution.error_code}),再等 5s 让前端轮询反应过来`);
      await new Promise((r) => setTimeout(r, 5000));
      const probe2 = await page.evaluate(() => /未配置大模型 API Key/.test(document.body.innerText || ''));
      success = probe2;
      if (success) break;
    }
  }
  await shot(page, 'bug01-fix-v3-03-after-click');

  // 7. 检查 LlmSetupPrompt
  const check = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      body_text: text.slice(0, 1200),
      has_llm_setup_prompt: /未配置大模型 API Key/.test(text),
      has_onboarding: /首次启动 · 配置大模型/.test(text),
      title: document.title,
    };
  });
  await shot(page, 'bug01-fix-v3-04-final');

  console.log('\n[7] 弹窗检查:');
  console.log('    LlmSetupPrompt 显示:', check.has_llm_setup_prompt ? '✅' : '❌');
  console.log('    OnboardingModal 显示:', check.has_onboarding ? '(也显示)' : '(未显示)');
  console.log('\n页面内容片段:');
  console.log(check.body_text.slice(0, 400).replace(/\n+/g, ' | '));

  success = success || check.has_llm_setup_prompt;
  console.log('\n====================================');
  console.log('BUG-01 整体修复:', success ? '✅ 已修复' : '❌ 未修复');
  console.log('====================================\n');

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'bug01-fix-v3-summary.json'),
    JSON.stringify(
      {
        target_project_id: TARGET_PROJECT_ID,
        new_project_id: newProjectId,
        llm_setup_prompt_visible: check.has_llm_setup_prompt,
        onboarding_visible: check.has_onboarding,
        click_result: clickResult,
        success,
      },
      null,
      2
    )
  );

  await browser.close();
  process.exit(success ? 0 : 1);
})().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});