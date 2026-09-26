/**
 * InsightForge UX 测试脚本 - 首页 Home 流程
 *
 * 通过 puppeteer-core 驱动本地 Chrome/Edge,逐步测试首页 UX:
 * 1. 首屏视觉检查 + OnboardingModal
 * 2. 输入校验
 * 3. 示例想法填充
 * 4. 保存为模板 Modal
 * 5. 删除模板
 * 6. 跳转到 Discuss
 * 7. 快捷键 ? 和 /
 * 8. 触发 API 调用 + MISSING_API_KEY Modal
 * 9. 跳转到 /settings
 *
 * 截图输出到 tests/ux-screenshots/home-*.png
 */
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const SHOT_DIR = path.resolve(__dirname, '../tests/ux-screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ISSUES = [];
const OKS = [];

function shot(page, name) {
  return page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}

function record(category, msg) {
  if (category === 'ISSUE') ISSUES.push(msg);
  else OKS.push(msg);
  console.log(`[${category}] ${msg}`);
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
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  await page.setViewport({ width: 1280, height: 900 });

  // 收集 console 错误
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });

  // 步骤 1: 首屏
  console.log('\n=== 步骤 1: 首屏视觉检查 ===');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'home-01-initial');

  // 检测关键元素
  const titleText = await page.$eval('h1', (el) => el.textContent || '').catch(() => '');
  if (titleText.includes('InsightForge')) record('OK', 'h1 含 InsightForge');
  else record('ISSUE', `h1 不含 InsightForge: "${titleText}"`);

  const subtitle = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p'));
    return ps.map((p) => p.textContent || '').join(' | ');
  });
  if (subtitle.includes('5 分钟')) record('OK', '副标题包含 "5 分钟"');
  else record('ISSUE', `副标题缺失 5 分钟: "${subtitle.slice(0, 200)}"`);

  const placeholder = await page.$eval('textarea', (el) => el.getAttribute('placeholder') || '').catch(() => '');
  if (placeholder.includes('VS Code 插件')) record('OK', 'textarea placeholder 正确');
  else record('ISSUE', `textarea placeholder 异常: "${placeholder}"`);

  // 验证按钮
  const buttons = await page.$$eval('button', (els) =>
    els.map((e) => (e.textContent || '').trim()).filter(Boolean)
  );
  console.log('  按钮列表:', buttons);
  if (buttons.some((b) => b.includes('马上验证想法'))) record('OK', '主按钮存在');
  else record('ISSUE', '主按钮 "马上验证想法" 缺失');
  if (buttons.some((b) => b.includes('探讨'))) record('OK', '次按钮 "探讨" 存在');
  else record('ISSUE', '次按钮 "探讨" 缺失');

  // 验证示例
  const exampleTags = await page.$$eval('button', (els) =>
    els
      .filter((e) => (e.textContent || '').match(/^(SaaS|工具|内容|硬件|教育)/))
      .map((e) => (e.textContent || '').trim())
  );
  console.log('  示例标签:', exampleTags);
  if (exampleTags.length >= 5) record('OK', `示例想法 ${exampleTags.length} 个`);
  else record('ISSUE', `示例想法数量不足: ${exampleTags.length}`);

  // OnboardingModal
  const modalOpen = await waitVisible(page, '[role="dialog"], .modal, [class*="modal"]', 3000);
  if (modalOpen) record('OK', 'OnboardingModal 自动弹出');
  else record('ISSUE', 'OnboardingModal 未弹出(预期没有 LLM Key 时应弹出)');

  await shot(page, 'home-02-onboarding');

  // 步骤 2: 关闭 OnboardingModal
  console.log('\n=== 步骤 2: 关闭 OnboardingModal ===');
  // 尝试找关闭按钮
  const closed = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const closeBtn = buttons.find(
      (b) => /稍后|跳过|关闭|×|✕|x/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || ''))
    );
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    return false;
  });
  if (closed) {
    await new Promise((r) => setTimeout(r, 800));
    record('OK', 'OnboardingModal 关闭成功');
  } else {
    record('ISSUE', '找不到 OnboardingModal 关闭按钮');
  }
  await shot(page, 'home-03-after-onboarding');

  // 步骤 3: 输入校验
  console.log('\n=== 步骤 3: 输入校验 ===');
  await page.click('textarea').catch(() => {});
  await page.type('textarea', 'abc');
  await new Promise((r) => setTimeout(r, 300));
  const submitDisabled = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').includes('马上验证想法')
    );
    return btn ? btn.disabled : null;
  });
  console.log('  submit disabled when input<5 chars:', submitDisabled);
  if (submitDisabled === true) record('OK', '<5 字符时主按钮 disabled');
  else record('ISSUE', '<5 字符时主按钮未禁用');
  await shot(page, 'home-04-input-validation');

  // 步骤 4: 测试示例想法填充
  console.log('\n=== 步骤 4: 测试示例想法填充 ===');
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  // 点击 SaaS 示例
  const exampleClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const saasBtn = btns.find((b) => /^SaaS/.test((b.textContent || '').trim()));
    if (saasBtn) {
      saasBtn.click();
      return true;
    }
    return false;
  });
  if (exampleClicked) {
    await new Promise((r) => setTimeout(r, 500));
    const filledValue = await page.$eval('textarea', (el) => el.value).catch(() => '');
    console.log('  填充后值:', filledValue.slice(0, 80));
    if (filledValue.includes('SaaS')) record('OK', '示例想法点击后填充到输入框');
    else record('ISSUE', `示例想法填充异常: "${filledValue}"`);

    // 验证保存为模板按钮出现
    const saveTplVisible = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).some(
        (b) => (b.textContent || '').includes('保存为模板')
      );
    });
    if (saveTplVisible) record('OK', '填充想法后出现 "保存为模板" 按钮');
    else record('ISSUE', '填充想法后未出现 "保存为模板" 按钮');
  } else {
    record('ISSUE', '找不到 SaaS 示例按钮');
  }
  await shot(page, 'home-05-example-filled');

  // 步骤 5: 保存为模板 Modal
  console.log('\n=== 步骤 5: 保存为模板 Modal ===');
  const openSaveTpl = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').includes('保存为模板')
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (openSaveTpl) {
    await new Promise((r) => setTimeout(r, 600));
    await shot(page, 'home-06-save-template-modal');

    // 填入模板名称 + 标签
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      const labelInput = inputs.find((i) => i.placeholder?.includes('SaaS 工具') || i.maxLength === 30);
      const tagInput = inputs.find((i) => i.placeholder?.includes('SaaS'));
      if (labelInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(labelInput, '我的 SaaS 模板');
        labelInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (tagInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(tagInput, 'SaaS');
        tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 300));

    // 点击保存
    const saved = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const saveBtn = btns.find(
        (b) => (b.textContent || '').trim() === '保存' && !b.disabled
      );
      if (saveBtn) {
        saveBtn.click();
        return true;
      }
      return false;
    });
    if (saved) {
      await new Promise((r) => setTimeout(r, 500));
      // 验证模板出现在 "我的模板" 区
      const tplShown = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).some(
          (b) => (b.textContent || '').includes('我的 SaaS 模板')
        );
      });
      if (tplShown) record('OK', '保存模板后出现在 "我的模板" 列表');
      else record('ISSUE', '保存模板后未出现在 "我的模板" 列表');
      await shot(page, 'home-07-template-saved');
    } else {
      record('ISSUE', '找不到模板保存按钮');
    }
  } else {
    record('ISSUE', '找不到保存为模板按钮');
  }

  // 步骤 6: 删除模板
  console.log('\n=== 步骤 6: 删除模板 ===');
  page.on('dialog', async (d) => {
    await d.accept();
  });
  const deleted = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const delBtn = btns.find(
      (b) => (b.getAttribute('aria-label') || '').includes('删除模板')
    );
    if (delBtn) {
      delBtn.click();
      return true;
    }
    return false;
  });
  if (deleted) {
    await new Promise((r) => setTimeout(r, 1000));
    const tplGone = await page.evaluate(() => {
      return !Array.from(document.querySelectorAll('button')).some(
        (b) => (b.textContent || '').includes('我的 SaaS 模板')
      );
    });
    if (tplGone) record('OK', '删除模板成功');
    else record('ISSUE', '删除模板后仍存在');
    await shot(page, 'home-08-template-deleted');
  } else {
    record('ISSUE', '找不到模板删除按钮');
  }

  // 步骤 7: 测试 "我还没有想清楚,需要探讨一下" 按钮
  console.log('\n=== 步骤 7: 测试 "探讨" 按钮跳转 ===');
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'AI 学习助手');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  const discussJumped = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const discussBtn = btns.find(
      (b) => (b.textContent || '').includes('我还没有想清楚')
    );
    if (discussBtn) {
      discussBtn.click();
      return true;
    }
    return false;
  });
  if (discussJumped) {
    await new Promise((r) => setTimeout(r, 1500));
    const url = page.url();
    console.log('  跳转后 URL:', url);
    if (url.includes('/discuss')) record('OK', '探讨按钮跳转到 /discuss');
    else record('ISSUE', `探讨按钮跳转 URL 异常: ${url}`);
    await shot(page, 'home-09-discuss-jumped');
  } else {
    record('ISSUE', '找不到 "探讨" 按钮');
  }

  // 步骤 8: 测试快捷键 ? 和 /
  console.log('\n=== 步骤 8: 测试快捷键 ===');
  // 先回到首页
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  // 按 ?
  await page.keyboard.press('?');
  await new Promise((r) => setTimeout(r, 700));
  const helpShown = await page.evaluate(() => {
    const text = document.body.textContent || '';
    return /快捷键|keyboard|shortcut/i.test(text);
  });
  await shot(page, 'home-10-shortcuts-help');
  if (helpShown) record('OK', '按 ? 弹出快捷键说明');
  else record('ISSUE', '按 ? 未弹出快捷键说明');

  // 关闭 + 按 /
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.press('/');
  await new Promise((r) => setTimeout(r, 400));
  const focusedAfterSlash = await page.evaluate(() => {
    const ae = document.activeElement;
    return ae ? ae.tagName : '';
  });
  console.log('  按 / 后焦点元素:', focusedAfterSlash);
  if (focusedAfterSlash === 'TEXTAREA') record('OK', '按 / 聚焦 textarea');
  else record('ISSUE', `按 / 未聚焦 textarea: ${focusedAfterSlash}`);
  await shot(page, 'home-11-slash-focus');

  // 步骤 9: 触发 API 调用 (无 LLM Key 应该弹 MISSING_API_KEY)
  console.log('\n=== 步骤 9: 触发提交 - 期望 MISSING_API_KEY Modal ===');
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '一个帮助新手快速上手 VS Code 的插件');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  const submitClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const submitBtn = btns.find(
      (b) => (b.textContent || '').includes('马上验证想法') && !b.disabled
    );
    if (submitBtn) {
      submitBtn.click();
      return true;
    }
    return false;
  });
  if (submitClicked) {
    // 等 API 调用完成
    await new Promise((r) => setTimeout(r, 3000));
    await shot(page, 'home-12-after-submit');

    const hasLlmPrompt = await page.evaluate(() => {
      const text = document.body.textContent || '';
      return /API Key|API key|api.key|api_key|MISSING_API_KEY|配置.*Key|配置 LLM/i.test(text);
    });
    if (hasLlmPrompt) record('OK', '提交后弹出 LLM 配置提示');
    else record('ISSUE', '提交后未弹出 LLM 配置提示');

    // 点击 "去设置"
    const wentSettings = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const goBtn = btns.find(
        (b) => /去设置|设置|settings/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || ''))
      );
      if (goBtn) {
        goBtn.click();
        return true;
      }
      return false;
    });
    if (wentSettings) {
      await new Promise((r) => setTimeout(r, 1500));
      const url = page.url();
      console.log('  去设置后 URL:', url);
      if (url.includes('/settings')) record('OK', '点击 "去设置" 跳转到 /settings');
      else record('ISSUE', `"去设置" 跳转异常: ${url}`);
      await shot(page, 'home-13-settings-jumped');
    } else {
      record('INFO', '未找到 "去设置" 按钮,可能 modal 未出现');
    }
  } else {
    record('ISSUE', '找不到可用的 "马上验证想法" 按钮');
  }

  // 最终汇总
  console.log('\n\n========== 测试汇总 ==========');
  console.log(`✅ 通过项: ${OKS.length}`);
  console.log(`❌ 问题项: ${ISSUES.length}`);
  console.log(`🐞 Console 错误: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.log('前 5 条:');
    consoleErrors.slice(0, 5).forEach((e) => console.log('  ' + e));
  }

  console.log('\n--- 问题清单 ---');
  ISSUES.forEach((i, idx) => console.log(`${idx + 1}. ${i}`));

  console.log('\n--- 通过项 ---');
  OKS.forEach((o, idx) => console.log(`${idx + 1}. ${o}`));

  await browser.close();

  // 把 ISSUES 也写到文件便于复盘
  fs.writeFileSync(
    path.join(SHOT_DIR, 'home-issues.json'),
    JSON.stringify(
      {
        issues: ISSUES,
        oks: OKS,
        consoleErrors,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('测试脚本崩溃:', err);
  process.exit(1);
});