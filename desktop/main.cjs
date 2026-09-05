/**
 * InsightForge 桌面版 - Electron 主进程
 *
 * 职责:
 *   1. 以纯 Node 模式(fork + ELECTRON_RUN_AS_NODE)启动后端服务
 *   2. 通过 IPC 接收后端实际监听端口(后端 PORT=0 随机分配)
 *   3. 创建 BrowserWindow 加载后端托管的本地前端页面
 *
 * 资源布局:
 *   - 开发模式:   desktop/resources/{backend,frontend-dist}
 *   - 打包后:     <安装目录>/resources/{backend,frontend-dist}
 */
const { app, BrowserWindow, shell, dialog, session, ipcMain } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const {
  startOpenSerpContainer,
  waitOpenSerpReady,
  stopOpenSerpContainer,
} = require('./scripts/openSerpManager.cjs');

/** IPC: 用系统默认程序打开指定路径文件(历史文档快捷打开) */
ipcMain.handle('open-path', async (_event, p) => {
  if (typeof p !== 'string' || p.trim().length === 0) {
    return { ok: false, message: '无效的文件路径' };
  }
  try {
    const err = await shell.openPath(p.trim());
    return err ? { ok: false, message: err } : { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

/**
 * IPC: 弹原生目录选择对话框,把 sourceDir 整个目录复制到用户选定位置。
 * 用于商业计划书的"另存为目录"交互(桌面端不依赖浏览器另存路径)。
 *
 * 入参: { sourceDir: string; defaultName: string }
 * 返回: { ok, canceled?, targetDir?, message? }
 */
ipcMain.handle('save-dir', async (_event, args) => {
  const sourceDir = args && typeof args === 'object' ? args.sourceDir : '';
  const defaultName = args && typeof args === 'object' && typeof args.defaultName === 'string'
    ? args.defaultName
    : '商业计划书';

  if (!sourceDir || typeof sourceDir !== 'string' || !fs.existsSync(sourceDir)) {
    return { ok: false, message: '源目录不存在或路径无效' };
  }
  if (!fs.statSync(sourceDir).isDirectory()) {
    return { ok: false, message: '源路径不是一个目录' };
  }

  try {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择另存到的目标目录',
      buttonLabel: '另存到此',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const parent = result.filePaths[0];
    // 子目录名重名时自动追加 "(1)"、"(2)" 后缀,避免覆盖
    let target = path.join(parent, defaultName);
    let i = 1;
    while (fs.existsSync(target)) {
      target = path.join(parent, `${defaultName} (${i++})`);
    }
    // 递归复制整个目录(Node 16.7+ 内置 fs.cpSync;项目使用 Node 22+)
    fs.cpSync(sourceDir, target, { recursive: true });
    return { ok: true, targetDir: target };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

/** 单实例锁: 防止重复启动 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let backendProc = null;

/** 解析运行时资源目录(开发/打包两态) */
function resolveResourceDir() {
  return app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, 'resources');
}

/**
 * 解析可写的数据目录。
 *
 * ⚠️ packaged 模式必须用 app.getPath('userData'):
 *   - electron-builder 默认 asar:true, main.cjs 落在 resources/app.asar 里
 *   - asar 是只读虚拟文件系统, fs.mkdirSync 写 asar 路径会报 EROFS,
 *     better-sqlite3 open 也会报 SQLITE_CANTOPEN, 后端必然 exit(1)
 *   - NSIS 装到 C:\Program Files\InsightForge 时, "Program Files" 也没有写权限
 *     (即使不开 asar 也通不过)
 *   - 唯一稳妥的写入位置: %APPDATA%\insightforge-desktop\
 *     ⚠️ 注意: 这是基于 package.json 的 "name" 字段(Electron 默认规则),
 *              与 electron-builder 的 appId("ai.insightforge.desktop")不是一回事。
 *              appId 只影响 NSIS 注册表键 / Mac bundle ID / Win 任务栏 AUMID,
 *              不会改变 userData 路径。
 *
 * dev 模式行为(自 v1.7.1):
 *   - 优先用 desktop/data/ (向后兼容, 老开发工作流)
 *   - 若 desktop/data/insightforge.db 不存在 → 回退到 packaged 路径
 *     (%APPDATA%\insightforge-desktop\), 让开发者能在 dev 模式下直接复用
 *     packaged 版写入的真实历史项目数据,避免两套数据互不可见。
 *   - 两边都没有 → 新建 desktop/data/。
 *
 * 风险提示: dev 模式与 packaged 模式不能同时运行一个数据库文件
 * (better-sqlite3 共享 WAL 锁); 真要双向同步,请用工具导出/导入。
 */
function resolveUserDataDir() {
  if (app.isPackaged) {
    return app.getPath('userData'); // %APPDATA%\insightforge-desktop
  }
  // dev 模式: 优先 desktop/data/ (历史兼容)
  const devDataDir = path.join(__dirname, 'data');
  const devDb = path.join(devDataDir, 'insightforge.db');
  if (fs.existsSync(devDb)) {
    fs.mkdirSync(devDataDir, { recursive: true });
    return devDataDir;
  }
  // dev 模式未发现本地数据 → 回退到 packaged 版用户数据目录,
  // 便于开发者直接看到自己之前在 packaged 版产生的历史项目。
  // schema 一致性: packaged 版固定 release 版 schema,dev 模式跟着 git HEAD 走。
  // SCHEMA_SQL 用 CREATE TABLE IF NOT EXISTS,新表/新列首次访问时自动补齐,
  // 但反向不会自动删除 packaged 版的字段(只多不少,安全)。
  try {
    const packagedDir = app.getPath('userData'); // %APPDATA%\insightforge-desktop
    const packagedDb = path.join(packagedDir, 'insightforge.db');
    if (fs.existsSync(packagedDb)) {
      console.log(`[desktop] dev 模式: desktop/data/insightforge.db 不存在,回退到 packaged 用户数据 ${packagedDir}`);
      fs.mkdirSync(packagedDir, { recursive: true });
      return packagedDir;
    }
  } catch (err) {
    // app 还未 ready 时 app.getPath 可能抛错,降级到 dev data
    console.warn(`[desktop] 探测 packaged userData 失败: ${err.message}`);
  }
  // 都没有 → 创建本地 dev data 目录
  fs.mkdirSync(devDataDir, { recursive: true });
  return devDataDir;
}

/**
 * resolveUserDataDir 的安全版本: 用于在 app 还未 ready 时拿到路径
 * (供 showResourceNotReadyPage 提示用户/重置数据库使用)
 */
function resolveUserDataDirSafe() {
  try {
    return app.isPackaged ? app.getPath('userData') : path.join(__dirname, 'data');
  } catch {
    return path.join(__dirname, 'data');
  }
}

/** 后端 stdout/stderr 末尾 4KB ring buffer, 用于失败页展示 */
const BACKEND_LOG_TAIL_BYTES = 4096;
let backendLogTail = '';
function appendBackendLog(chunk) {
  const text = chunk.toString('utf8');
  backendLogTail = (backendLogTail + text).slice(-BACKEND_LOG_TAIL_BYTES);
}

/** 解析后端子进程入口 */
function resolveBackendEntry() {
  return path.join(resolveResourceDir(), 'backend', 'dist', 'index.js');
}

/** 解析窗口图标(开发/打包两态均能找到) */
function resolveWindowIcon() {
  // 打包后 __dirname 指向 resources/app/ 旁, build/ 与 main.cjs 同级不会被打入;
  // 这里使用 process.resourcesPath/build 作为兜底, 确保两种模式都能找到 logo
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'build', 'icon.png'),
        path.join(process.resourcesPath, '..', 'build', 'icon.png'),
      ]
    : [
        path.join(__dirname, 'build', 'icon.png'),
        path.resolve(__dirname, '..', 'build', 'icon.png'),
      ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

/**
 * v1.7+ 桌面启动协调: backend ready + OpenSerp 就绪后,调 backend reset 路由清开熔断器
 * 后端可能已在 OpenSerp 启动期装入熔断(等接 5 次连接拒绝),
 * 这里是清理一次性后门。
 */
async function resetOpenSerpBreaker(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/v1/admin/sources/breaker/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'openserp' }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) {
      console.warn(`[desktop] 重置 OpenSerp 熔断器 HTTP ${resp.status}`);
      return false;
    }
    const payload = await resp.json().catch(() => null);
    const existed = payload?.data?.existed;
    console.log(`[desktop] OpenSerp 熔断器已重置(existed=${existed})`);
    return true;
  } catch (err) {
    console.warn(`[desktop] 重置 OpenSerp 熔断器异常: ${err.message}`);
    return false;
  }
}

/** 启动后端子进程(纯 Node 模式) + 异步启动 OpenSerp 容器 */
function startBackend() {
  const entry = resolveBackendEntry();
  if (!fs.existsSync(entry)) {
    console.error(`[desktop] 后端入口不存在: ${entry}`);
    return null;
  }

  const userData = app.getPath('userData');
  const dataDir = resolveUserDataDir();
  const env = {
    ...process.env,
    // 关键: 让 electron.exe 以纯 Node 模式运行子进程
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    // 随机端口, 避免与用户本机其他服务冲突
    PORT: '0',
    // 数据与配置写入可写数据目录 (packaged 走 %APPDATA%, dev 走 desktop/data/).
    // ⚠️ packaged 模式下 __dirname 位于 resources/app.asar 只读虚拟文件系统,
    //           写 asar 路径会立即 EROFS / SQLITE_CANTOPEN, 后端必然 exit(1).
    DATABASE_URL: path.join(dataDir, 'insightforge.db'),
    DOTENV_CONFIG_PATH: path.join(dataDir, '.env'),
    // 托管前端静态资源
    SERVE_FRONTEND: path.join(resolveResourceDir(), 'frontend-dist'),
    // 历史文档自动归档目录(开发模式: 项目根/历史文档; 打包后: 用户数据目录)
    HISTORY_DOC_DIR: app.isPackaged
      ? path.join(userData, '历史文档')
      : path.join(path.resolve(__dirname, '..'), '历史文档'),
    // OpenSerp 默认本机地址; 桌面版不内置该服务, 后端已有优雅降级
    OPENSERP_URL: process.env.OPENSERP_URL || 'http://localhost:8080',
  };

  // 供调试/排错时定位数据目录
  console.log(`[desktop] data dir = ${dataDir}`);
  console.log(`[desktop] packaged = ${app.isPackaged}, userData = ${userData}`);

  // v1.7+: 启动 OpenSerp 容器(需要 Docker Desktop)。不阻塞 backend 启动:
  //   - 启动失败 → backend 仍走 OPENSERP_URL 原路径,失败 → 0 命中(已实装)
  //   - 启动成功 → backend 子进程会拿到真实 SERP 数据
  //   - 探活成功 → 告诉调用方,调用方会调 reset 路由清掉启动期可能误开的熔断
  // 启动 + 拉镜像全在后台,容器起来后 waitOpenSerpReady 探活一次。
  const openserpPromise = startOpenSerpContainer({ logger: console })
    .then(async (info) => {
      if (!info.ok) {
        console.warn(`[desktop] OpenSerp 未启用: ${info.reason}`);
        return { ok: false, reason: info.reason };
      }
      console.log(`[desktop] OpenSerp 容器 ${info.reused ? '复用' : '新启'}: ${info.containerName}`);
      const ready = await waitOpenSerpReady({ logger: console });
      if (!ready) {
        console.warn('[desktop] OpenSerp 未在 30s 内就绪,搜索引擎通道仍可能不可用');
        return { ok: false, reason: 'OpenSerp 30s 内未就绪' };
      }
      return { ok: true, containerName: info.containerName, reused: info.reused };
    })
    .catch((err) => {
      console.warn(`[desktop] OpenSerp 启动异常: ${err.message},不影响 backend`);
      return { ok: false, reason: err.message };
    });

  const child = fork(entry, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  child.stdout?.on('data', (d) => { appendBackendLog(d); process.stdout.write(`[backend] ${d}`); });
  child.stderr?.on('data', (d) => { appendBackendLog(d); process.stderr.write(`[backend] ${d}`); });
  child.on('exit', (code, signal) => {
    console.log(`[desktop] 后端进程退出 code=${code} signal=${signal ?? 'none'}`);
    backendProc = null;
  });

  return { child, openserpPromise };
}

/** 等待后端就绪, 返回实际端口 */
function waitBackendReady(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('后端启动超时'));
    }, timeoutMs);

    child.on('message', (msg) => {
      if (msg && msg.type === 'ready' && typeof msg.port === 'number') {
        clearTimeout(timer);
        resolve(msg.port);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`后端进程提前退出 code=${code}`));
    });
  });
}

/** 创建主窗口 */
function createWindow(port) {
  const iconPath = resolveWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0F172A',
    title: 'InsightForge',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // 外部链接一律交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1')) {
      e.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
    }
  });

  // 网页文档标题加载完成后强制刷一次, 避免某些情况下被前端页面改写
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle('InsightForge');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

/** "资源未就绪" 页面(含最近后端日志 + 可写路径提示, 方便排错) */
function showResourceNotReadyPage(reason) {
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const userDataDir = resolveUserDataDirSafe();
  const dbPath = path.join(userDataDir, 'insightforge.db');
  const envPath = path.join(userDataDir, '.env');
  const tailText = backendLogTail ? backendLogTail.trim() : '';

  const html = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8" />
<title>InsightForge</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin:0; padding:0; height:100%; }
  body {
    background:#0F172A; color:#E2E8F0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Microsoft YaHei", sans-serif;
    display:flex; align-items:center; justify-content:center;
    min-height:100vh; padding:24px; box-sizing:border-box;
  }
  .card { text-align:left; max-width:760px; width:100%; }
  .badge {
    display:inline-block; padding:4px 10px; border-radius:999px;
    background:rgba(56,189,248,0.15); color:#7DD3FC;
    font-size:12px; letter-spacing:0.5px; margin-bottom:16px;
  }
  h1 { margin:8px 0 6px; font-size:22px; font-weight:600; color:#F1F5F9; }
  p  { margin:6px 0; color:#94A3B8; line-height:1.6; font-size:14px; }
  code {
    background:rgba(148,163,184,0.15); padding:2px 6px; border-radius:4px;
    font-size:13px; color:#E2E8F0;
    word-break:break-all;
  }
  .hint { margin-top:10px; font-size:12px; color:#64748B; line-height:1.6; }
  pre.log {
    max-height:240px; overflow:auto;
    background:#020617; color:#CBD5E1;
    padding:12px; border-radius:6px;
    font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    margin-top:12px; white-space:pre-wrap; word-break:break-all;
  }
  hr { border:none; border-top:1px solid rgba(148,163,184,0.2); margin:14px 0; }
</style>
</head><body>
<div class="card">
  <span class="badge">InsightForge Desktop</span>
  <h1>资源未就绪</h1>
  <p>${escHtml(reason)}</p>
  ${tailText ? `<pre class="log">${escHtml(tailText)}</pre>` : ''}
  <hr />
  <p class="hint">用户数据目录: <code>${escHtml(userDataDir)}</code></p>
  <p class="hint">数据库文件:&nbsp;&nbsp;&nbsp;&nbsp; <code>${escHtml(dbPath)}</code></p>
  <p class="hint">环境变量文件: <code>${escHtml(envPath)}</code></p>
  <p class="hint">若数据库损坏, 可手动删除上述数据库文件后重启。</p>
  <p class="hint">需要技术支持请把上方 "原因 + 后端日志" 截屏发给团队。</p>
</div>
</body></html>`;

  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const iconPath = resolveWindowIcon();
  const win = new BrowserWindow({
    width: 760,
    height: 560,
    backgroundColor: '#0F172A',
    title: 'InsightForge',
    icon: iconPath,
    autoHideMenuBar: true,
  });
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    win.setTitle('InsightForge');
  });
  win.loadURL(dataUrl);
}

/**
 * 统一处理前端触发的下载(a[download] / blob URL)
 * 弹出系统保存对话框,让用户明确选择保存位置,避免"下载后找不到文件"的困惑
 */
function setupDownloadHandler() {
  session.defaultSession.on('will-download', (event, item) => {
    // 已有显式保存路径则不再弹窗
    if (item.getSavePath()) return;

    const filename = item.getFilename() || 'insightforge-download';
    event.preventDefault();
    dialog
      .showSaveDialog(mainWindow ?? undefined, {
        title: '保存文件',
        defaultPath: path.join(app.getPath('downloads'), filename),
        buttonLabel: '保存',
      })
      .then((result) => {
        if (result.canceled || !result.filePath) {
          return; // 用户取消保存
        }
        item.setSavePath(result.filePath);
        item.resume();
      })
      .catch((err) => {
        console.error(`[desktop] 保存对话框失败: ${err.message}`);
        // 回退:保存到系统下载目录
        item.setSavePath(path.join(app.getPath('downloads'), filename));
        item.resume();
      });
  });
}

/** 主流程 */
async function bootstrap() {
  // Windows: 注册应用 UserModelId, 任务栏/通知中心才能正确显示品牌
  if (process.platform === 'win32') {
    app.setAppUserModelId('ai.insightforge.desktop');
  }

  // 统一下载处理: 报告 / 开发文档 / 落地页等文件保存
  // (商业计划书不再走 HTTP 下载,改为走 IPC save-dir 弹目录对话框另存)
  setupDownloadHandler();

  const entry = resolveBackendEntry();
  if (!fs.existsSync(entry)) {
    showResourceNotReadyPage('后端入口文件未找到, 请先构建桌面版资源。');
    return;
  }

  const handle = startBackend();
  if (!handle) return;
  backendProc = handle.child;

  try {
    const port = await waitBackendReady(handle.child);
    console.log(`[desktop] 后端就绪, 端口=${port}`);
    createWindow(port);

    // v1.7+: OpenSerp 就绪后主动重置 backend 的 openserp 熔断器。
    // 启动期后端可能已经连续失败(OpenSerp 还没起来)把熔断打到了 open。
    // 重置后首次 SERP 请求能正常发出,不需要等 30s 冷却窗口。
    handle.openserpPromise
      .then((result) => {
        if (result.ok) {
          console.log(`[desktop] OpenSerp 就绪 (${result.containerName}),重置后端熔断器...`);
          return resetOpenSerpBreaker(port);
        }
        return false;
      })
      .catch((err) => {
        console.warn(`[desktop] OpenSerp 就绪后重置异常: ${err.message}`);
      });
  } catch (err) {
    console.error(`[desktop] 启动失败: ${err.message}`);
    showResourceNotReadyPage(`后端启动失败: ${err.message}`);
  }
}

app.whenReady().then(bootstrap);

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (backendProc) {
    backendProc.kill();
    backendProc = null;
  }
  // v1.7+: 桌面退出时清理 OpenSerp 容器(--rm 会自动删除)
  try {
    stopOpenSerpContainer();
  } catch (err) {
    console.warn(`[desktop] 停止 OpenSerp 容器失败: ${err.message}`);
  }
});