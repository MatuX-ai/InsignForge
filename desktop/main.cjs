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

/** 启动后端子进程(纯 Node 模式) */
function startBackend() {
  const entry = resolveBackendEntry();
  if (!fs.existsSync(entry)) {
    console.error(`[desktop] 后端入口不存在: ${entry}`);
    return null;
  }

  const userData = app.getPath('userData');
  const env = {
    ...process.env,
    // 关键: 让 electron.exe 以纯 Node 模式运行子进程
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    // 随机端口, 避免与用户本机其他服务冲突
    PORT: '0',
    // 数据与配置写入用户数据目录(可写, 持久化)
    DATABASE_URL: path.join(__dirname, 'data', 'insightforge.db'),
    DOTENV_CONFIG_PATH: path.join(__dirname, 'data', '.env'),
    // 托管前端静态资源
    SERVE_FRONTEND: path.join(resolveResourceDir(), 'frontend-dist'),
    // 历史文档自动归档目录(开发模式: 项目根/历史文档; 打包后: 用户数据目录)
    HISTORY_DOC_DIR: app.isPackaged
      ? path.join(userData, '历史文档')
      : path.join(path.resolve(__dirname, '..'), '历史文档'),
    // OpenSerp 默认本机地址; 桌面版不内置该服务, 后端已有优雅降级
    OPENSERP_URL: process.env.OPENSERP_URL || 'http://localhost:8080',
  };

  const child = fork(entry, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  child.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  child.on('exit', (code) => {
    console.log(`[desktop] 后端进程退出 code=${code}`);
    backendProc = null;
  });

  return child;
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

/** "资源未就绪" 页面(双保险: 强制设置 title 与项目品牌) */
function showResourceNotReadyPage(reason) {
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
    height:100vh; padding:24px; box-sizing:border-box;
  }
  .card { text-align:center; max-width:560px; }
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
  }
  .hint { margin-top:18px; font-size:12px; color:#64748B; }
</style>
</head><body>
<div class="card">
  <span class="badge">InsightForge Desktop</span>
  <h1>资源未就绪</h1>
  <p>请先在项目根目录执行 <code>xpm run build:desktop</code> (或 <code>npm run build:desktop</code>) 完成构建后重试。</p>
  <p class="hint">原因: ${reason}</p>
</div>
</body></html>`;

  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const iconPath = resolveWindowIcon();
  const win = new BrowserWindow({
    width: 720,
    height: 420,
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

  // 统一下载处理: 报告 / 文档 / 商业计划书 / 落地页等文件保存
  setupDownloadHandler();

  const entry = resolveBackendEntry();
  if (!fs.existsSync(entry)) {
    showResourceNotReadyPage('后端入口文件未找到, 请先构建桌面版资源。');
    return;
  }

  backendProc = startBackend();
  if (!backendProc) return;

  try {
    const port = await waitBackendReady(backendProc);
    console.log(`[desktop] 后端就绪, 端口=${port}`);
    createWindow(port);
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
});