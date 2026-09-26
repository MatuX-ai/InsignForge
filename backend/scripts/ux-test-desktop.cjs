/**
 * 桌面端 UI 集成测试 - 通过 Electron 暴露的端口访问
 * 桌面端将后端 + 前端 SPA 一起托管,直接访问 http://127.0.0.1:<port> 即可
 */
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const SHOT_DIR = path.resolve(__dirname, '../tests/ux-screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const BACKEND_PORT = process.env.BACKEND_PORT || 63219;
const BASE = `http://127.0.0.1:${BACKEND_PORT}`;

async function pickChromeExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

async function main() {
  const exe = await pickChromeExe();
  if (!exe) throw new Error('chrome not found');

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultTimeout(30000);

  const results = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`);
  });

  console.log(`[test] desktop URL: ${BASE}`);

  // 1. 加载首页
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-01-home.png') });
  const homeInfo = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent || '',
    bodyText: document.body.textContent?.slice(0, 200) || '',
  }));
  console.log('[home]', homeInfo);
  results.push({ name: 'home', ok: homeInfo.h1.includes('InsightForge'), info: homeInfo });

  // 2. 关闭 OnboardingModal
  const closed = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const c = btns.find((b) => /稍后|跳过|关闭|×|✕/i.test(b.textContent || ''));
    if (c) { c.click(); return true; }
    return false;
  });
  await new Promise((r) => setTimeout(r, 500));
  console.log('[onboarding] closed:', closed);

  // 3. 输入想法
  await page.click('textarea');
  await page.type('textarea', '一个帮程序员快速理解代码的 AI 助手');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-02-input.png') });

  // 4. 测试快捷键 ?
  await page.keyboard.press('Escape');
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('?');
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-03-shortcuts.png') });
  const helpOk = await page.evaluate(() => /快捷键|快捷键说明|keyboard/i.test(document.body.textContent || ''));
  console.log('[shortcuts ?] ok:', helpOk);
  results.push({ name: 'shortcuts_help', ok: helpOk });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));

  // 5. 测试快捷键 /
  await page.keyboard.press('/');
  await new Promise((r) => setTimeout(r, 400));
  const focused = await page.evaluate(() => document.activeElement?.tagName || '');
  console.log('[shortcuts /] focus:', focused);
  results.push({ name: 'slash_focus', ok: focused === 'TEXTAREA' });

  // 6. 提交想法 - 期望 MISSING_API_KEY 引导(但 BUG-01 会让它失败)
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '一个帮程序员快速理解代码的 AI 助手插件');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const submitClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').includes('马上验证想法') && !b.disabled
    );
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('[submit] clicked:', submitClicked);

  // 等待后端响应
  await new Promise((r) => setTimeout(r, 5000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-04-after-submit.png') });
  const submitUrl = page.url();
  console.log('[submit] url:', submitUrl);

  // 7. 检查是否在 Report 页
  const isReport = submitUrl.includes('/report/');
  console.log('[submit] on report page:', isReport);
  results.push({ name: 'submit_to_report', ok: isReport, url: submitUrl });

  // 8. 报告页检查
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-05-report.png') });
  const reportInfo = await page.evaluate(() => ({
    title: document.title,
    text: document.body.textContent?.slice(0, 300) || '',
    hasLoading: /加载|loading|分析|调研/i.test(document.body.textContent || ''),
    hasError: /失败|出错|错误|API/i.test(document.body.textContent || ''),
    hasSetup: /设置|API.Key|未配置/i.test(document.body.textContent || ''),
  }));
  console.log('[report]', reportInfo);
  results.push({ name: 'report_loaded', ok: reportInfo.hasLoading || reportInfo.hasError, info: reportInfo });

  // 9. 跳转到设置页
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-06-settings.png') });
  const settingsInfo = await page.evaluate(() => ({
    title: document.title,
    hasLlm: /LLM|大模型|API.Key/i.test(document.body.textContent || ''),
    hasSearch: /搜索/i.test(document.body.textContent || ''),
    hasOffline: /离线/i.test(document.body.textContent || ''),
    hasProxy: /代理/i.test(document.body.textContent || ''),
  }));
  console.log('[settings]', settingsInfo);
  results.push({ name: 'settings', ok: settingsInfo.hasLlm, info: settingsInfo });

  // 10. 跳转到历史记录
  await page.goto(`${BASE}/history`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-07-history.png') });
  const historyInfo = await page.evaluate(() => ({
    title: document.title,
    hasProject: /项目|调研|记录/i.test(document.body.textContent || ''),
    hasNew: /新建|开始|调研/i.test(document.body.textContent || ''),
  }));
  console.log('[history]', historyInfo);
  results.push({ name: 'history', ok: historyInfo.hasProject, info: historyInfo });

  // 11. 跳转到监控中心
  await page.goto(`${BASE}/monitor`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-08-monitor.png') });
  const monitorInfo = await page.evaluate(() => ({
    title: document.title,
    text: document.body.textContent?.slice(0, 300) || '',
  }));
  console.log('[monitor]', monitorInfo);
  results.push({ name: 'monitor', ok: /监控|health|DB|LLM/i.test(monitorInfo.text), info: monitorInfo });

  // 12. 跳转到讨论
  await page.goto(`${BASE}/discuss`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-09-discuss.png') });
  const discussInfo = await page.evaluate(() => ({
    title: document.title,
    hasInput: document.querySelectorAll('input,textarea').length,
    hasNew: /新建|讨论|梳理/i.test(document.body.textContent || ''),
  }));
  console.log('[discuss]', discussInfo);
  results.push({ name: 'discuss', ok: discussInfo.hasInput > 0 || discussInfo.hasNew, info: discussInfo });

  // 汇总
  console.log('\n========== 桌面端 UX 测试汇总 ==========');
  const okCount = results.filter((r) => r.ok).length;
  console.log(`通过: ${okCount}/${results.length}`);
  results.forEach((r) => console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}`));
  console.log(`\nConsole 错误: ${consoleErrors.length}`);
  consoleErrors.slice(0, 10).forEach((e) => console.log('  ' + e));

  fs.writeFileSync(
    path.join(SHOT_DIR, 'desktop-ux-summary.json'),
    JSON.stringify({ results, consoleErrors, backendPort: BACKEND_PORT, ts: new Date().toISOString() }, null, 2)
  );

  await browser.close();
}

main().catch((e) => {
  console.error('crash:', e);
  process.exit(1);
});