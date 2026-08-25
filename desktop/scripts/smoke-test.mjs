// 桌面版冒烟测试: 模拟 Electron 主进程行为
// 1. spawn electron.exe(Node 模式) 启动后端 resources/backend/dist/index.js
// 2. 等待 IPC ready 消息获取实际端口
// 3. 验证: 首页 HTML / API / SPA fallback
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(__dirname, '..');
const electronExe = path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe');
const backendEntry = path.join(desktop, 'resources', 'backend', 'dist', 'index.js');
const frontendDist = path.join(desktop, 'resources', 'frontend-dist');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insightforge-smoke-'));
const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  NODE_ENV: 'production',
  PORT: '0',
  DATABASE_URL: path.join(tmpDir, 'smoke.db'),
  DOTENV_CONFIG_PATH: path.join(tmpDir, '.env'),
  SERVE_FRONTEND: frontendDist,
};

console.log('启动后端子进程 (模拟主进程 fork)...');
const child = spawn(electronExe, [backendEntry], {
  env,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

child.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
child.stderr.on('data', (d) => process.stdout.write(`[backend:err] ${d}`));

const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('后端就绪超时')), 30_000);
  child.on('message', (msg) => {
    if (msg?.type === 'ready') {
      clearTimeout(timer);
      resolve(msg.port);
    }
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`后端提前退出 code=${code}`));
  });
});
console.log(`✅ 后端就绪, 端口=${port}`);

// ---------- 验证 1: 首页 HTML ----------
const home = await fetch(`http://127.0.0.1:${port}/`);
const homeText = await home.text();
console.log(`✅ 首页 HTTP ${home.status}, 包含 #root: ${homeText.includes('<div id="root">')}`);

// ---------- 验证 2: API ----------
const api = await fetch(`http://127.0.0.1:${port}/api/v1/projects`);
const apiJson = await api.json();
console.log(`✅ API /api/v1/projects HTTP ${api.status}, code=${apiJson.code}, data 是数组: ${Array.isArray(apiJson.data)} (${apiJson.data?.length ?? '?'} 条)`);

// ---------- 验证 3: 健康检查 ----------
const health = await fetch(`http://127.0.0.1:${port}/health`);
console.log(`✅ /health HTTP ${health.status}`);

// ---------- 验证 4: SPA fallback ----------
const spa = await fetch(`http://127.0.0.1:${port}/history`);
const spaText = await spa.text();
console.log(`✅ SPA fallback /history HTTP ${spa.status}, 返回 index.html: ${spaText.includes('<div id="root">')}`);

// ---------- 清理: 等待子进程完全退出后删除临时目录 ----------
child.kill();
await new Promise((r) => child.once('exit', r));
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('\n🎉 冒烟测试全部通过');
process.exit(0);
