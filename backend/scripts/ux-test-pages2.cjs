/**
 * InsightForge UX 测试 - 简化版
 * 只测试页面元素和文字内容,不做 fullPage 截图(避免超时)
 */
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const SHOT_DIR = path.resolve(__dirname, '../tests/ux-screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const RESULTS = {};

async function pickChromeExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

async function shot(page, name) {
  // 仅截视口大小,避免 fullPage 等待整个长页面渲染
  return page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: false,
    timeout: 15000,
  }).catch((e) => console.warn(`  shot fail ${name}: ${e.message}`));
}

async function quickVisit(page, url, waitMs = 1500) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {}
  await new Promise((r) => setTimeout(r, waitMs));
}

async function evalText(page, fn) {
  try {
    return await Promise.race([
      page.evaluate(fn),
      new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), 8000)),
    ]);
  } catch (e) {
    return { __error: e.message };
  }
}

async function testHistory(page) {
  console.log('\n=== /history ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/history', 2000);
  await shot(page, 'p-history');

  const data = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasEmptyHint: /暂无|还没有|去新建调研|开始你的/i.test(text),
      buttonCount: document.querySelectorAll('button').length,
      projectCardCount: document.querySelectorAll('[class*="card"],[class*="project"]').length,
    };
  });
  console.log('  ', data);
  if (data.buttonCount < 5) issues.push('按钮数量过少');
  RESULTS.History = { issues, data };
}

async function testSettings(page) {
  console.log('\n=== /settings ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/settings', 2000);
  await shot(page, 'p-settings');

  const data = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasLlm: /LLM|大模型|API.Key/i.test(text),
      hasSearch: /搜索|搜索引擎/i.test(text),
      hasOffline: /离线/i.test(text),
      hasProxy: /代理/i.test(text),
      hasImport: /导入|导出/i.test(text),
      formInputs: document.querySelectorAll('input,textarea,select').length,
    };
  });
  console.log('  ', data);
  if (!data.hasLlm) issues.push('缺 LLM 配置区块');
  if (!data.hasSearch) issues.push('缺搜索引擎配置');
  if (!data.hasOffline) issues.push('缺离线模式');
  if (!data.hasProxy) issues.push('缺代理配置');
  RESULTS.Settings = { issues, data };
}

async function testMonitor(page) {
  console.log('\n=== /monitor ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/monitor', 3000);
  await shot(page, 'p-monitor');

  const data = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasDb: /数据库|DB/i.test(text),
      hasCache: /缓存/i.test(text),
      hasLlm: /LLM|大模型/i.test(text),
      hasSched: /调度|scheduler/i.test(text),
      hasSources: /数据源|源/i.test(text),
      cards: document.querySelectorAll('[class*="card"]').length,
    };
  });
  console.log('  ', data);
  if (Object.values(data).filter((v) => typeof v === 'boolean' && v).length < 2) {
    issues.push('监控页面无明显指标');
  }
  RESULTS.Monitor = { issues, data };
}

async function testDiscuss(page) {
  console.log('\n=== /discuss ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/discuss', 2000);
  await shot(page, 'p-discuss');

  const data = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasNewBtn: /新建|创建|开始/i.test(text),
      hasCanvas: /画布|canvas|分组|节点|要点/i.test(text),
      inputs: document.querySelectorAll('input,textarea').length,
    };
  });
  console.log('  ', data);
  if (data.inputs === 0) issues.push('讨论页无输入控件');
  RESULTS.Discuss = { issues, data };
}

async function testReport(page) {
  console.log('\n=== /report/<id> ===');
  const issues = [];

  // 不存在的项目
  await quickVisit(page, 'http://localhost:3000/report/non-existent-id-9999', 2000);
  await shot(page, 'p-report-notfound');
  const nfData = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasNotFound: /不存在|未找到|404|无法/i.test(text),
      hasLoading: /加载|loading/i.test(text),
      hasError: /错误|error|失败/i.test(text),
    };
  });
  console.log('  not-found:', nfData);

  // 真实失败项目(刚才创建的)
  await quickVisit(page, 'http://localhost:3000/report/5581d664-1825-4466-a503-4ba94d923fce', 3000);
  await shot(page, 'p-report-failed');
  const failData = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasFailed: /失败|出错|未生成|重新|重试/i.test(text),
      hasApiKeyHint: /API.Key|去设置|未配置/i.test(text),
      hasTabs: /概览|执行|分析|导出|趋势|页面|Tab/i.test(text),
      hasActions: /重新调研|重试|导出|下载/i.test(text),
    };
  });
  console.log('  real-failed:', failData);
  // 因为 BUG-01, 应该不会显示 "去设置"
  if (failData.hasFailed && !failData.hasApiKeyHint) {
    issues.push('⚠️ BUG-01: 失败报告未引导去设置 API Key');
  }
  RESULTS.Report = { issues, notfound: nfData, failed: failData };
}

async function testCompare(page) {
  console.log('\n=== /compare ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/compare', 2000);
  await shot(page, 'p-compare');

  const data = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasSelectHint: /选择|select|项目/i.test(text),
      hasEmpty: /暂无|请选择|选择项目/i.test(text),
    };
  });
  console.log('  ', data);
  RESULTS.Compare = { issues, data };
}

async function testReadme(page) {
  console.log('\n=== /readme ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/readme', 2000);
  await shot(page, 'p-readme');

  const data = await evalText(page, () => ({
    title: document.querySelector('h1,h2')?.textContent || '',
    textLen: document.body.textContent?.length || 0,
  }));
  console.log('  ', data);
  if (data.textLen < 500) issues.push('README 内容过少');
  RESULTS.Readme = { issues, data };
}

async function testFaq(page) {
  console.log('\n=== /faq ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/faq', 2000);
  await shot(page, 'p-faq');

  const data = await evalText(page, () => {
    const text = document.body.textContent || '';
    return {
      title: document.querySelector('h1,h2')?.textContent || '',
      hasFaq: /常见问题|FAQ/i.test(text),
      questions: (text.match(/\?|？/g) || []).length,
    };
  });
  console.log('  ', data);
  RESULTS.Faq = { issues, data };
}

async function testAuthCallback(page) {
  console.log('\n=== /auth/callback ===');
  const issues = [];
  await quickVisit(page, 'http://localhost:3000/auth/callback', 2000);
  await shot(page, 'p-auth');

  const data = await evalText(page, () => ({
    title: document.querySelector('h1,h2')?.textContent || '',
    textLen: document.body.textContent?.length || 0,
  }));
  console.log('  ', data);
  RESULTS.AuthCallback = { issues, data };
}

async function main() {
  const exe = await pickChromeExe();
  if (!exe) throw new Error('chrome not found');
  console.log(`[boot] ${exe}`);

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    protocolTimeout: 90000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });

  await testHistory(page);
  await testSettings(page);
  await testMonitor(page);
  await testDiscuss(page);
  await testReport(page);
  await testCompare(page);
  await testReadme(page);
  await testFaq(page);
  await testAuthCallback(page);

  console.log('\n\n========== 测试汇总 ==========');
  console.log(`Console 错误: ${consoleErrors.length}`);
  consoleErrors.slice(0, 20).forEach((e) => console.log('  ' + e));

  for (const [name, r] of Object.entries(RESULTS)) {
    console.log(`\n[${name}]`);
    if (r.issues.length === 0) console.log('  ✅ 无问题');
    else r.issues.forEach((i, idx) => console.log(`  ❌ ${idx + 1}. ${i}`));
    console.log('  data:', JSON.stringify(r.data || r.notfound || r.failed || {}, null, 0));
  }

  fs.writeFileSync(
    path.join(SHOT_DIR, 'ux-summary2.json'),
    JSON.stringify({ results: RESULTS, consoleErrors, ts: new Date().toISOString() }, null, 2)
  );

  await browser.close();
}

main().catch((e) => {
  console.error('crash:', e);
  process.exit(1);
});