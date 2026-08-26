#!/usr/bin/env node
/**
 * 端到端讨论流程测试脚本
 *
 * 流程:
 *   创建讨论(business_model) → 首条消息触发市场调研工具调用 → 轮询任务 → 打印对话与画布
 *
 * 运行前置条件:
 *   1. 后端已启动(http://localhost:3001)
 *   2. 已配置 LLM API Key(设置页或后端 .env)
 *   3. 已配置模拟 MCP 通道(后端 .env 增加):
 *        INSIGHTFORGE_MCP_COMMAND=node E:/Dady_project/InsignForge/scripts/mock-mcp-server.mjs
 *      然后重启后端。
 *
 * 运行方式(在项目根目录):
 *   node scripts/test-discussion-flow.mjs
 *
 * 若想测试"直连通道"(不配置 INSIGHTFORGE_MCP_COMMAND),同样可跑,
 * 但直连需要 OpenSerp/SerpAPI 等真实搜索源。
 */
const BASE = 'http://localhost:3001/api/v1';

async function request(path, init) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json();
  if (body.code !== 0) throw new Error(`HTTP ${res.status}: ${body.message}`);
  return body.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 输入数据: 故意写成"方向模糊 + 明确要求看市场",用于触发 market_research 工具 */
const MESSAGE =
  '我想做一个 AI 健身私教应用,帮用户根据身体数据自动生成训练计划。' +
  '请你先帮我调研一下:这个方向有没有人在做、有没有真实需求?' +
  '如果市场可行,再帮我梳理一下商业模式。';

async function main() {
  console.log('▶ 1. 创建讨论会话(mode=business_model)并发送首条消息');
  const { session } = await request('/discussions', {
    method: 'POST',
    body: JSON.stringify({
      title: '端到端测试:AI 健身私教',
      mode: 'business_model',
      message: MESSAGE,
    }),
  });
  console.log('   session id =', session.id);

  // 轮询讨论任务(最多 120s)
  console.log('▶ 2. 轮询讨论任务(每 2s,最长 120s)...');
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    let job;
    try {
      job = await request(`/discussions/${session.id}/chat/status`);
    } catch {
      break; // 任务已结束被清理(404),直接查会话
    }
    if (job.status === 'success' || job.status === 'failed') break;
    console.log(`   进行中... ${job.current_step}`);
  }

  const s = await request(`/discussions/${session.id}`);

  console.log('\n▶ 3. 对话内容');
  for (const m of s.messages) {
    const who = m.role === 'user' ? '🧑 用户' : '🤖 AI';
    const body = (m.content || '').slice(0, 1200) + ((m.content || '').length > 1200 ? '\n...(截断展示)' : '');
    console.log(`\n---- ${who} ----\n${body}`);
  }

  console.log('\n▶ 4. 画布结构');
  for (const g of s.canvas.groups) {
    const points = g.points.map((p) => `   - [${p.status}] ${p.text}`).join('\n');
    console.log(`\n■ ${g.title}\n${points || '   (空)'}`);
  }

  const hasResearchData = s.messages.some((m) => m.content?.startsWith('【调研数据】'));
  const hasPoints = s.canvas.groups.reduce((n, g) => n + g.points.length, 0) > 0;

  console.log('\n▶ 5. 结论');
  console.log(
    hasResearchData
      ? '  ✅ 出现【调研数据】消息 → MCP 调研通道已生效'
      : '  ⚠️ 未出现【调研数据】消息 → 可能走了直连、未触发工具调用,或 MCP 通道回退'
  );
  console.log(hasPoints ? '  ✅ 画布已生成要点' : '  ⚠️ 画布为空(可再追问几轮)');
  console.log('\n完成。可在浏览器打开 /discuss 查看完整会话。');
}

main().catch((err) => {
  console.error('\n❌ 测试失败:', err.message);
  console.error('   请确认: 后端已启动、LLM Key 已配置、mock-mcp 路径正确');
  process.exit(1);
});
