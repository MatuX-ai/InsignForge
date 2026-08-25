// 冒烟测试辅助: 用 spawn 调用 electron.exe (Node 模式) 并捕获输出
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const desktop = 'e:/Dady_project/InsignForge/desktop';
const electronExe = `${desktop}/node_modules/electron/dist/electron.exe`;
// 测试文件必须放在 resources/backend 内, 保证 require 从该目录的 node_modules 解析
const testFile = `${desktop}/resources/backend/abi-test.cjs`;

fs.writeFileSync(
  testFile,
  `const Database=require('better-sqlite3');
const db=new Database(':memory:');
db.exec('CREATE TABLE t(a)');
db.prepare('INSERT INTO t VALUES (1)').run();
console.log('RESULT better-sqlite3 OK rows='+db.prepare('SELECT COUNT(*) c FROM t').get().c);
`
);

const r = spawnSync(electronExe, [testFile], {
  cwd: `${desktop}/resources/backend`,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 30_000,
});

console.log('status:', r.status);
console.log('stdout:', r.stdout);
console.log('stderr:', r.stderr);

fs.rmSync(testFile, { force: true });
