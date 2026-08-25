#!/usr/bin/env node
/**
 * 端到端冒烟测试:真实启动 backend(dist 产物),调用核心 API 验证
 *
 * 覆盖:
 *   - 服务健康检查 / 根路由
 *   - 项目 CRUD(创建/列表/详情/删除)
 *   - 设置查询、需求库查询
 *   - 落地页守卫(未完成调研应被拒绝)
 *   - 404 / 参数校验错误
 *   - 落地页生成 + Markdown 导出(通过临时 DB 直接写入一份已完成报告)
 *
 * 运行方式(项目根目录):
 *   node scripts/e2e-smoke.mjs
 *
 * 说明:
 *   - 使用随机端口 + 临时 SQLite,不触碰本机 3001 开发服务与真实数据
 *   - 全程无需真实 LLM / 搜索 API Key
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND_ENTRY = path.join(ROOT, 'backend', 'dist', 'index.js');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ` (${extra})` : ''}`);
  }
}

async function main() {
  if (!existsSync(BACKEND_ENTRY)) {
    console.error(`后端产物不存在: ${BACKEND_ENTRY}\n请先运行 npm run build --workspace=insightforge-backend`);
    process.exit(1);
  }

  // ---------- 1. 启动测试实例 ----------
  const port = 32000 + Math.floor(Math.random() * 1000);
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'insightforge-e2e-'));
  const dbPath = path.join(tmpDir, 'e2e.db');

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: dbPath,
    LOG_LEVEL: 'error',
  };

  console.log(`▶ 启动后端: PORT=${port}, DB=${dbPath}`);
  const child = spawn(process.execPath, [BACKEND_ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(`  [backend] ${d}`));
  child.stderr.on('data', (d) => process.stdout.write(`  [backend:err] ${d}`));

  const BASE = `http://127.0.0.1:${port}`;
  const API = `${BASE}/api/v1`;

  // 等待就绪(最多 15s)
  console.log('▶ 等待后端就绪...');
  const ready = await (async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) return { ok: false, reason: `后端提前退出 code=${child.exitCode}` };
      try {
        const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return { ok: true };
      } catch {
        /* 未就绪,重试 */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return { ok: false, reason: '等待超时' };
  })();

  if (!ready.ok) {
    console.error(`❌ 后端未能就绪: ${ready.reason}`);
    child.kill();
    process.exit(1);
  }
  console.log('  ✅ 后端就绪\n');

  const request = async (path_, init) => {
    const res = await fetch(API + path_, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* 非 JSON */
    }
    return { status: res.status, body, text: body === null ? await res.text() : undefined };
  };

  // ---------- 2. 健康检查 & 根路由 ----------
  console.log('▶ 健康检查 / 根路由');
  {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json();
    check('GET /health → 200 + status ok', res.status === 200 && body.status === 'ok', JSON.stringify(body));
  }
  {
    const res = await fetch(`${BASE}/`);
    const body = await res.json();
    check('GET / → 后端信息', res.status === 200 && typeof body.name === 'string' && body.version, `name=${body.name}`);
  }

  // ---------- 3. 项目 CRUD ----------
  console.log('\n▶ 项目 CRUD');
  let project;
  {
    const r = await request('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'E2E 冒烟项目', description: '这是一个用于端到端冒烟测试的项目描述' }),
    });
    project = r.body?.data;
    check('POST /projects → 创建成功', r.status === 200 && r.body?.code === 0 && project?.id, `id=${project?.id?.slice(0, 8)}`);
  }
  {
    const r = await request('/projects', { method: 'POST', body: JSON.stringify({ description: '短' }) });
    check('POST /projects 描述过短 → 400', r.status === 400 && r.body?.code === 400, `code=${r.body?.code}`);
  }
  {
    const r = await request('/projects');
    const found = (r.body?.data ?? []).some((p) => p.id === project?.id);
    check('GET /projects → 列表包含新建项目', r.status === 200 && found, `共 ${r.body?.data?.length ?? 0} 条`);
  }
  {
    const r = await request(`/projects/${project?.id}`);
    check('GET /projects/:id → 详情 + 报告为 null', r.status === 200 && r.body?.data?.status === 'draft' && r.body?.data?.report === null, `status=${r.body?.data?.status}`);
  }
  {
    const r = await request('/projects/nonexistent-id');
    check('GET /projects/:id 不存在 → 404', r.status === 404 && r.body?.code === 404, `code=${r.body?.code}`);
  }
  {
    const r = await request('/projects');
    check('初始 GET /projects → 数组', r.status === 200 && Array.isArray(r.body?.data), '');
  }

  // ---------- 4. 设置 & 需求库 ----------
  console.log('\n▶ 设置 / 需求库');
  {
    const r = await request('/settings/llm');
    check('GET /settings/llm → LLM 状态', r.status === 200 && typeof r.body?.data?.provider === 'string', `provider=${r.body?.data?.provider}`);
  }
  {
    const r = await request('/market-needs');
    check('GET /market-needs → 数组', r.status === 200 && Array.isArray(r.body?.data), '');
  }

  // ---------- 5. 落地页守卫 ----------
  console.log('\n▶ 落地页守卫(未完成调研)');
  {
    const r = await request(`/projects/${project?.id}/landing`, { method: 'POST', body: JSON.stringify({}) });
    check('POST /landing 未完成调研 → 400', r.status === 400 && /调研/.test(r.body?.message ?? ''), r.body?.message);
  }

  // ---------- 6. 404 兜底 ----------
  console.log('\n▶ 404 兜底');
  {
    const res = await fetch(`${API}/does-not-exist`);
    const body = await res.json();
    check('未知 API 路径 → 404 JSON', res.status === 404 && body?.code === 404, '');
  }

  // ---------- 7. 落地页生成 + Markdown 导出(种子一份已完成报告) ----------
  console.log('\n▶ 落地页生成 / Markdown 导出(种子报告)');
  {
    // 直接写入临时 DB:将项目标记为 completed 并插入一份报告
    const db = new Database(dbPath);
    db.prepare(`UPDATE projects SET status='completed', updated_at=datetime('now') WHERE id=?`).run(project.id);
    const report = {
      summary: '端到端冒烟测试报告摘要:市场热度中等,需求明确。',
      market_heat: { search_volume: 12500, discussion_count: 342, trend: 'rising', heat_score: 72 },
      competitors: [
        { name: '竞品A', description: '面向企业用户的解决方案', url: 'https://example.com/a', strengths: ['功能完整'], weaknesses: ['价格高'] },
        { name: '竞品B', description: '开源社区方案', url: 'https://example.com/b', strengths: ['免费'], weaknesses: ['无技术支持'] },
      ],
      pain_points: ['用户抱怨操作繁琐', '缺乏自动化'],
      market_size: '约 5 亿美元',
      risks: ['已有巨头进入'],
      opportunities: ['细分垂直场景'],
      sources: [{ title: '行业讨论', url: 'https://example.com/src', date: '2026-08-01', source: 'reddit' }],
      generated_at: new Date().toISOString(),
    };
    db.prepare(`INSERT INTO project_reports (id, project_id, report_data) VALUES (?, ?, ?)`).run(
      'report-e2e-0001',
      project.id,
      JSON.stringify(report)
    );
    db.close();
    console.log('  (已在临时 DB 写入 completed 项目 + 报告)');

    const r = await request(`/projects/${project?.id}/landing`, { method: 'POST', body: JSON.stringify({}) });
    const html = r.body?.data?.html ?? '';
    check('POST /landing → 生成落地页 HTML', r.status === 200 && r.body?.code === 0 && /<!doctype html/i.test(html), `${r.body?.data?.size ?? 0} bytes`);
    check('落地页 filename 后缀', /落地页\.html$/.test(r.body?.data?.filename ?? ''), r.body?.data?.filename);

    const exportRes = await fetch(`${API}/projects/${project?.id}/export/markdown`);
    const md = await exportRes.text();
    check('GET /export/markdown → 200 + Markdown', exportRes.status === 200 && md.includes('# InsightForge 市场调研报告'), `${md.length} chars`);
  }

  // ---------- 8. 清理 ----------
  console.log('\n▶ 清理');
  {
    const r = await request(`/projects/${project?.id}`, { method: 'DELETE' });
    check('DELETE /projects/:id → 删除成功', r.status === 200 && r.body?.code === 0, '');
  }
  {
    const r = await request('/projects');
    const gone = !(r.body?.data ?? []).some((p) => p.id === project?.id);
    check('删除后列表不再包含该项目', gone, `共 ${r.body?.data?.length ?? 0} 条`);
  }

  // ---------- 关闭 ----------
  console.log('\n▶ 关闭测试实例');
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  rmSync(tmpDir, { recursive: true, force: true });
  console.log('  ✅ 已关闭并清理临时目录');

  // ---------- 汇总 ----------
  console.log(`\n=== 端到端冒烟测试完成: ${passed} 通过, ${failed} 失败 ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌ 端到端冒烟测试异常:', err.message);
  process.exit(1);
});
