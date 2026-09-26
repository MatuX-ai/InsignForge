/**
 * InsightForge UX 测试脚本 - 综合测试其他页面
 * 测试范围: 历史记录 / 讨论梳理 / 设置 / 监控 / 报告 / README / FAQ
 *
 * 注意: 由于后端缺少 LLM API Key,有些功能(创建调研/讨论触发等)会失败,
 *      但仍可验证页面布局、空状态、表单、路由跳转等 UX 表现。
 */
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const SHOT_DIR = path.resolve(__dirname, '../tests/ux-screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const RESULTS = {};

function shot(page, name) {
  return page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true, timeout: 30000 }).catch((e) => {
    console.warn(`  ⚠️ 截图失败 ${name}: ${e.message}`);
  });
}

async function pickChromeExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function waitVisible(page, selector, timeoutMs = 5000) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function recordResult(pageName, issues, observations) {
  RESULTS[pageName] = { issues, observations, screenshot: `${pageName}.png` };
}

async function testHistory(page) {
  console.log('\n=== 测试页面: 历史记录 /history ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/history', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'history-01-initial', false);

  const title = await page.evaluate(() => document.querySelector('h1, h2, [class*="title"]')?.textContent || '');
  console.log('  标题:', title);
  observations.push(`标题: ${title}`);

  // 检查是否有空状态文案
  const emptyState = await page.evaluate(() => {
    return /暂无|还没有|空状态|去新建|开始你的/i.test(document.body.textContent || '');
  });
  console.log('  空状态文案:', emptyState);
  if (emptyState) observations.push('显示空状态提示');
  else issues.push('无明显空状态文案');

  // 查找导航按钮
  const navButtons = await page.$$eval('button, a', (els) =>
    els.map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 30)
  );
  console.log('  可见按钮:', navButtons.slice(0, 10));
  observations.push(`按钮数量: ${navButtons.length}`);

  await recordResult('History', issues, observations);
}

async function testSettings(page) {
  console.log('\n=== 测试页面: 设置 /settings ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'settings-01-initial', false);

  // 检查标签/分类
  const tabs = await page.$$eval('[role="tab"], button', (els) =>
    els
      .map((e) => (e.textContent || '').trim())
      .filter((t) => /LLM|搜索|代理|离线|导入|导出|数据|模型/i.test(t))
  );
  console.log('  设置分类:', tabs);
  observations.push(`设置分类: ${tabs.length} 个`);

  // 查找 LLM 配置相关
  const llmRelated = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasLlmProvider: /LLM|大模型|provider/i.test(text),
      hasApiKey: /API.Key/i.test(text),
      hasSearchConfig: /搜索|搜索引擎|OPENSERP|SERP/i.test(text),
      hasOfflineMode: /离线模式|offline/i.test(text),
      hasProxy: /代理|proxy/i.test(text),
    };
  });
  console.log('  配置项:', llmRelated);
  observations.push(JSON.stringify(llmRelated));

  if (!llmRelated.hasLlmProvider) issues.push('未显示 LLM 配置');
  if (!llmRelated.hasApiKey) issues.push('未显示 API Key 配置');

  // 测试 LLM 状态显示
  const llmStatus = await page.evaluate(() => {
    const allText = document.body.textContent || '';
    const m = allText.match(/(未配置|已配置|当前模型|provider.*?未配置)/i);
    return m ? m[0] : null;
  });
  console.log('  LLM 状态:', llmStatus);
  observations.push(`LLM 状态: ${llmStatus}`);

  await recordResult('Settings', issues, observations);
}

async function testMonitor(page) {
  console.log('\n=== 测试页面: 监控中心 /monitor ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/monitor', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'monitor-01-initial', false);

  // 检查监控指标
  const metrics = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasDatabase: /数据库|DB|sqlite/i.test(text),
      hasCache: /缓存|cache/i.test(text),
      hasScheduler: /调度|scheduler/i.test(text),
      hasLlm: /LLM|大模型/i.test(text),
      hasSources: /数据源|sources/i.test(text),
    };
  });
  console.log('  监控指标:', metrics);
  observations.push(JSON.stringify(metrics));

  const hasAnyMetric = Object.values(metrics).some(Boolean);
  if (!hasAnyMetric) issues.push('监控页面无任何指标显示');

  await recordResult('Monitor', issues, observations);
}

async function testDiscuss(page) {
  console.log('\n=== 测试页面: 讨论梳理 /discuss ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/discuss', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'discuss-01-initial', false);

  // 检查页面元素
  const elements = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasTitle: /讨论|梳理|画布/i.test(text),
      hasNewButton: /新建|创建|开始/i.test(text),
      hasEmptyHint: /暂无|还没有|空/i.test(text),
      hasCanvas: /画布|canvas|分组|节点/i.test(text),
      hasChat: /消息|对话|发送|chat/i.test(text),
    };
  });
  console.log('  元素:', elements);
  observations.push(JSON.stringify(elements));

  if (!elements.hasTitle && !elements.hasCanvas) issues.push('讨论页无明显核心元素');

  // 检查是否有输入框
  const inputs = await page.$$eval('input, textarea', (els) => els.length);
  console.log('  输入控件数:', inputs);
  if (inputs === 0) issues.push('讨论页无任何输入控件');

  await recordResult('Discuss', issues, observations);
}

async function testReport(page) {
  console.log('\n=== 测试页面: 报告页 /report/test ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/report/non-existent', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'report-01-notfound', false);

  const handle = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasNotFound: /不存在|未找到|404|加载失败|出错/i.test(text),
      hasLoading: /加载|loading/i.test(text),
      hasError: /错误|error/i.test(text),
    };
  });
  console.log('  不存在项目处理:', handle);
  observations.push(JSON.stringify(handle));

  // 测试一个真实项目(刚才创建的)
  await page.goto('http://localhost:3000/report/5581d664-1825-4466-a503-4ba94d923fce', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await shot(page, 'report-02-real', false);

  const realHandle = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasFailed: /失败|出错|未生成|请重试/i.test(text),
      hasApiKeyHint: /API.Key|去设置/i.test(text),
      hasTabs: /概览|执行|分析|导出|趋势/i.test(text),
      hasActions: /重新调研|重试|导出|下载/i.test(text),
    };
  });
  console.log('  真实失败报告处理:', realHandle);
  observations.push(JSON.stringify(realHandle));

  // 因为 BUG-01(error_code 为 null), 报告页应该不会自动引导去设置
  if (!realHandle.hasApiKeyHint && realHandle.hasFailed) {
    issues.push('⚠️ BUG-01 表现: 失败报告没有引导去设置 API Key');
  }

  await recordResult('Report', issues, observations);
}

async function testCompare(page) {
  console.log('\n=== 测试页面: 报告对比 /compare ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/compare', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'compare-01-initial', false);

  const elements = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasTitle: /对比|compare/i.test(text),
      hasSelectHint: /选择|select/i.test(text),
      hasEmpty: /暂无|请选择|选择项目/i.test(text),
    };
  });
  console.log('  元素:', elements);
  observations.push(JSON.stringify(elements));

  await recordResult('Compare', issues, observations);
}

async function testReadme(page) {
  console.log('\n=== 测试页面: README /readme ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/readme', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'readme-01-initial', false);

  const text = await page.evaluate(() => document.body.textContent || '');
  console.log('  内容长度:', text.length);
  if (text.length < 200) issues.push('README 页面内容过少');

  await recordResult('Readme', issues, observations);
}

async function testFaq(page) {
  console.log('\n=== 测试页面: FAQ /faq ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/faq', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'faq-01-initial', false);

  const elements = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasFaq: /常见问题|FAQ/i.test(text),
      hasQuestion: /\?|？/.test(text),
      hasAccordion: /details|accordion|展开|折叠|summary/i.test(text),
    };
  });
  console.log('  元素:', elements);
  observations.push(JSON.stringify(elements));

  await recordResult('Faq', issues, observations);
}

async function testAuthCallback(page) {
  console.log('\n=== 测试页面: 鉴权回调 /auth/callback ===');
  const issues = [];
  const observations = [];
  await page.goto('http://localhost:3000/auth/callback', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'auth-01-initial', false);

  const elements = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasError: /失败|错误|无效|missing|缺少/i.test(text),
      hasRedirect: /返回|redirect|登录/i.test(text),
    };
  });
  console.log('  元素:', elements);
  observations.push(JSON.stringify(elements));

  await recordResult('AuthCallback', issues, observations);
}

async function main() {
  const exe = await pickChromeExe();
  if (!exe) {
    console.error('❌ 没找到 Chrome 或 Edge 可执行文件');
    process.exit(1);
  }
  console.log(`[boot] using: ${exe}`);

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  await page.setViewport({ width: 1280, height: 900 });

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });

  // 关闭 OnboardingModal 先
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const closeBtn = buttons.find((b) => /稍后|跳过|关闭|×|✕/i.test(b.textContent || ''));
    closeBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  await testHistory(page);
  await testSettings(page);
  await testMonitor(page);
  await testDiscuss(page);
  await testReport(page);
  await testCompare(page);
  await testReadme(page);
  await testFaq(page);
  await testAuthCallback(page);

  // 报告汇总
  console.log('\n\n========== UX 测试汇总 ==========\n');
  console.log(`🐞 总 Console 错误数: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    consoleErrors.slice(0, 20).forEach((e) => console.log('  ' + e));
  }

  console.log('\n--- 各页面问题清单 ---');
  for (const [pageName, result] of Object.entries(RESULTS)) {
    console.log(`\n【${pageName}】 (${result.screenshot})`);
    if (result.issues.length === 0) console.log('  ✅ 无问题');
    else result.issues.forEach((i, idx) => console.log(`  ❌ ${idx + 1}. ${i}`));
    if (result.observations.length > 0) {
      console.log('  观察:');
      result.observations.forEach((o) => console.log(`    - ${o}`));
    }
  }

  // 写入汇总
  fs.writeFileSync(
    path.join(SHOT_DIR, 'ux-summary.json'),
    JSON.stringify(
      {
        results: RESULTS,
        consoleErrors,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );

  await browser.close();
}

main().catch((err) => {
  console.error('测试脚本崩溃:', err);
  process.exit(1);
});