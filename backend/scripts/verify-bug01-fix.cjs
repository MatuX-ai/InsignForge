/**
 * BUG-01 修复验证 (V2):
 * 1. 通过 API 直接触发调研(模拟用户点击,但更精确)
 * 2. 验证数据库持久化了 error_code='MISSING_API_KEY'
 * 3. 验证 status 接口正确返回 error_code
 * 4. 验证前端 LlmSetupPrompt 弹窗在错误码到位后正确显示
 */
const puppeteer = require('puppeteer-core');
const path = require('node:path');
const fs = require('node:fs');

const BACKEND = 'http://127.0.0.1:64744';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'tests', 'ux-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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

async function api(method, path, body) {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  const r = await fetch(`${BACKEND}${path}`, init);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

(async () => {
  console.log('======= BUG-01 修复验证 V2 =======\n');

  console.log('[1] 创建测试项目...');
  const create = await api('POST', '/api/v1/projects', {
    name: 'BUG-01 验证项目 V2',
    description: '测试 LLM API Key 缺失时弹窗是否正确弹出',
  });
  if (create.status !== 200) throw new Error('项目创建失败: ' + JSON.stringify(create));
  const projectId = create.json.data.id;
  console.log('  ✅ 项目已创建:', projectId);

  console.log('[2] 触发调研(后端会因为缺 API Key 失败)...');
  const trigger = await api('POST', `/api/v1/projects/${projectId}/research`);
  if (trigger.status !== 200) {
    console.log('  ⚠️ 触发响应:', trigger.json.message ?? trigger.json);
  } else {
    console.log('  ✅ 触发成功,execution_id:', trigger.json.data.execution_id);
  }

  console.log('[3] 轮询等待调研进入 failed 状态...');
  let finalStatus = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await api('GET', `/api/v1/projects/${projectId}/research/status`);
    if (s.status === 200) {
      const exec = s.json.data.execution;
      if (exec.status === 'failed') {
        finalStatus = s.json.data;
        console.log(`  ✅ 调研已失败 (第 ${i + 1}s)`);
        console.log('     execution.error_code =', exec.error_code);
        break;
      }
    }
  }
  if (!finalStatus) {
    console.log('  ❌ 调研未进入 failed 状态');
    process.exit(1);
  }

  // 核心验证点 1: 数据库持久化
  const errorCodePersisted = finalStatus.execution.error_code === 'MISSING_API_KEY';
  console.log(`\n[4] ${errorCodePersisted ? '✅' : '❌'} 核心验证 1: 数据库持久化 error_code`);
  console.log(`     expected: "MISSING_API_KEY"`);
  console.log(`     actual:   "${finalStatus.execution.error_code}"`);

  // 启动 puppeteer 验证前端弹窗
  console.log('\n[5] 启动 Puppeteer 验证前端弹窗...');
  const browser = await puppeteer.launch({
    executablePath: await findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${BACKEND}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));

  // 关闭 OnboardingModal(如有),只保留 LlmSetupPrompt
  await page.evaluate(() => {
    // 点掉 OnboardingModal 的"先跳过,去首页"按钮
    const buttons = Array.from(document.querySelectorAll('button'));
    const skip = buttons.find((b) => /先跳过|稍后再说|取消|关闭/.test(b.textContent || ''));
    if (skip) skip.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'bug01-fix-v2-01-home');

  // 跳到项目 research 页(模拟用户进入失败项目)
  console.log('[6] 跳转到失败项目的 research 页...');
  await page.goto(`${BACKEND}/projects/${projectId}/research`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 8000)); // 等 3s 轮询触发
  await shot(page, 'bug01-fix-v2-02-project-page');

  // 关键: 找到 LlmSetupPrompt 弹窗(title="未配置大模型 API Key")
  const modalCheck = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const hasMissingTitle = /未配置大模型 API Key/.test(text);
    const hasOnboarding = /首次启动 · 配置大模型/.test(text);
    return {
      has_missing_api_key_modal: hasMissingTitle,
      has_onboarding_modal: hasOnboarding,
      body_excerpt: text.slice(0, 800),
    };
  });
  await shot(page, 'bug01-fix-v2-03-modal-check');

  console.log('\n[7] 弹窗检查结果:');
  console.log('  LlmSetupPrompt (标题: 未配置大模型 API Key):', modalCheck.has_missing_api_key_modal ? '✅ 显示' : '❌ 未显示');
  console.log('  OnboardingModal (标题: 首次启动 · 配置大模型):', modalCheck.has_onboarding_modal ? '(也在显示)' : '(未显示)');

  const bug01Fixed = errorCodePersisted && modalCheck.has_missing_api_key_modal;

  console.log('\n========== 修复验证总结 ==========');
  console.log('1. 数据库 executions.error_code 持久化:', errorCodePersisted ? '✅' : '❌');
  console.log('2. 后端 /status 返回 error_code:', finalStatus.execution.error_code ? '✅' : '❌');
  console.log('3. 前端 LlmSetupPrompt 弹窗显示:', modalCheck.has_missing_api_key_modal ? '✅' : '❌');
  console.log('\nBUG-01 整体修复:', bug01Fixed ? '✅ 已修复' : '❌ 未完全修复');
  console.log('===================================\n');

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'bug01-fix-v2-summary.json'),
    JSON.stringify(
      {
        project_id: projectId,
        db_error_code_persisted: errorCodePersisted,
        api_returned_error_code: finalStatus.execution.error_code,
        llm_setup_prompt_visible: modalCheck.has_missing_api_key_modal,
        bug01_fixed: bug01Fixed,
      },
      null,
      2
    )
  );

  await browser.close();
  process.exit(bug01Fixed ? 0 : 1);
})().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});