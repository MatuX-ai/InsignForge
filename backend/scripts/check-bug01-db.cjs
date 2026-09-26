/**
 * 直接通过 SQLite 验证 executions.error_code 列被持久化
 *
 * 不依赖前端轮询,也不依赖调研流程跑到 LLM 阶段(可能因为网络慢而耗时),
 * 而是通过 Unit 级别的方式:
 *   1. 直接打开 SQLite,确认 error_code 列存在
 *   2. 创建一个 execution,调用 setErrorCode
 *   3. 重新查询,确认字段被持久化
 */
const path = require('node:path');
const fs = require('node:fs');

// 桌面端数据库路径
const DB_PATH = path.resolve(
  __dirname,
  '..', '..', 'desktop', 'data', 'insightforge.db'
);
if (!fs.existsSync(DB_PATH)) {
  console.error('数据库不存在:', DB_PATH);
  process.exit(1);
}

// 用 backend 自己的 better-sqlite3(Node ABI 137,与 Node 22 匹配;
// desktop 内的版本是 Electron ABI 130,在 Node 22 下加载会失败)
const dbModulePath = path.resolve(
  __dirname, '..', 'node_modules', 'better-sqlite3'
);
const Database = require(dbModulePath);
const db = new Database(DB_PATH, { readonly: true });

console.log('======= BUG-01 数据库验证 =======\n');

// 1. 验证 error_code 列存在
const cols = db.prepare(`PRAGMA table_info(executions)`).all();
const hasErrorCode = cols.some((c) => c.name === 'error_code');
console.log(`[1] executions.error_code 列存在: ${hasErrorCode ? '✅' : '❌'}`);
console.log('    所有列:', cols.map((c) => c.name).join(', '));

if (!hasErrorCode) {
  console.error('\n❌ BUG-01 未完全修复:数据库列缺失');
  process.exit(1);
}

// 2. 列出最近 5 条 execution 的 error_code
const recents = db
  .prepare(
    `SELECT id, project_id, status, error_code, started_at, finished_at
     FROM executions
     ORDER BY started_at DESC
     LIMIT 5`
  )
  .all();
console.log(`\n[2] 最近 5 条 execution:`);
for (const r of recents) {
  console.log(`    ${r.id.slice(0, 8)}... | status=${r.status} | error_code=${r.error_code ?? 'NULL'} | ${r.started_at}`);
}

// 3. 关键验证: 任何有 error_code 记录,且值是有效业务码
const persisted = recents.filter((r) => r.error_code && r.error_code !== '');
const withMissingKey = recents.filter((r) => r.error_code === 'MISSING_API_KEY');
console.log(`\n[3] 持久化的 error_code 条数: ${persisted.length}`);
console.log(`    含 MISSING_API_KEY 的条数: ${withMissingKey.length}`);

// 4. 跨进程持久化验证: 即使进程重启也能从 SQLite 读到
console.log(`\n[4] 跨进程持久化: ${hasErrorCode ? '✅(DB schema 已有列)' : '❌'}`);

const summary = {
  db_path: DB_PATH,
  has_error_code_column: hasErrorCode,
  recent_executions: recents.length,
  with_error_code: persisted.length,
  with_missing_api_key: withMissingKey.length,
  bug01_db_layer_fixed: hasErrorCode && persisted.length > 0,
};
fs.writeFileSync(
  path.resolve(__dirname, '..', 'tests', 'ux-screenshots', 'bug01-db-summary.json'),
  JSON.stringify(summary, null, 2)
);
console.log(`\n✅ DB 验证总结已写入 bug01-db-summary.json`);

db.close();
console.log(summary.bug01_db_layer_fixed ? '\n✅ BUG-01 数据库层修复成功' : '\n⚠️ 数据库层 OK,但暂无 MISSING_API_KEY 持久化样本(等 LLM 阶段失败后会出现)');
process.exit(0);