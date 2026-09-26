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
const { app, BrowserWindow, shell, dialog, session, ipcMain, Menu, Tray, Notification, clipboard } = require('electron');
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

/**
 * IPC: 渲染进程调用通知主进程跳转路由(v1.8 P0-A1)
 * 主进程向所有 BrowserWindow 广播 'desktop:navigate' 事件,前端
 * onNavigate 订阅后用 react-router 跳转。
 *
 * 为什么不是直接传 URL 打开新 BrowserWindow:
 *   产品定位是单窗口 SPA,路由跳转的体验远优于新开窗 + 跳转。
 */
ipcMain.handle('desktop:navigate', async (_event, pathArg) => {
  if (typeof pathArg !== 'string' || !pathArg.startsWith('/')) {
    return { ok: false, message: '路由必须以 / 开头' };
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('desktop:navigate', pathArg);
  }
  return { ok: true };
});

/**
 * IPC: 弹系统级通知(v1.8 P0-A2)
 * 调研完成/失败/历史归档生成时调用。
 * 通知点击时聚焦主窗口 + 跳转 /history。
 */
ipcMain.handle('desktop:notify', async (_event, args) => {
  if (!Notification.isSupported()) {
    return { ok: false, message: '当前系统不支持通知' };
  }
  const title = args && typeof args.title === 'string' ? args.title : 'InsightForge';
  const body = args && typeof args.body === 'string' ? args.body : '';
  const silent = !!(args && args.silent);
  try {
    const n = new Notification({ title, body, silent });
    n.on('click', () => {
      const main = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (main) {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
        main.webContents.send('desktop:navigate', '/history');
      }
    });
    n.show();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

/**
 * IPC: 复制文本到剪贴板(v1.8 P0-A6)
 * Banner 错误诊断导出用,Web 端可降级使用 navigator.clipboard.
 */
ipcMain.handle('desktop:copy', async (_event, text) => {
  if (typeof text !== 'string') {
    return { ok: false, message: '只能复制字符串' };
  }
  try {
    clipboard.writeText(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

/** 单实例锁: 防止重复启动 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // v1.8 P4-B: 第二个实例被主实例接管前,主实例会通过 'second-instance' 事件收到本实例的 argv.
  // 这里不直接退出,等待主实例处理完,我们再 quit() —— 避免主实例深链处理早于本进程退出。
  // 但为稳妥,仍调 app.quit(),Electron 会延迟到主实例 'second-instance' 回调返回后才退出。
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

/**
 * v1.8 P0-A1: 装载原生应用菜单 + 快捷键
 *
 * 设计要点:
 *   - 跨平台: macOS 用标准 appMenu role,Windows/Linux 用自定义中文菜单
 *   - 快捷键: 新建调研 Ctrl/Cmd+N、首页 Ctrl/Cmd+1、历史 Ctrl/Cmd+2、设置 Ctrl/Cmd+,、关于 F1
 *   - 点击菜单项通过 webContents.send('desktop:navigate', '/xxx') 通知前端路由
 *   - autoHideMenuBar 改为 false 后用户可以用 Alt 显示(同时增加 Alt 访达菜单提示)
 */
function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  /** 告诉渲染进程跳到指定路由的辅助函数 */
  function sendNavigate(path) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('desktop:navigate', path);
    }
  }

  /** 聚焦主窗口辅助 */
  function focusMain() {
    const main = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (main) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }
  }

  const template = [];

  // macOS: 标准 App Menu 占位(关于/服务/退出/隐藏)
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(
    {
      label: '文件',
      submenu: [
        {
          label: '新建调研',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendNavigate('/'),
        },
        { type: 'separator' },
        {
          label: '历史记录',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendNavigate('/history'),
        },
        {
          label: '监控中心',
          accelerator: 'CmdOrCtrl+3',
          click: () => sendNavigate('/monitor'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '首页',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendNavigate('/'),
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '设置',
      submenu: [
        {
          label: '偏好设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendNavigate('/settings'),
        },
        {
          label: '用户中心',
          accelerator: 'CmdOrCtrl+U',
          click: () => sendNavigate('/account'),
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '使用文档',
          accelerator: 'F1',
          click: () => sendNavigate('/readme'),
        },
        {
          label: '常见问题',
          click: () => sendNavigate('/faq'),
        },
        { type: 'separator' },
        {
          label: '关于 InsightForge',
          click: () => {
            focusMain();
            dialog.showMessageBox(mainWindow ?? undefined, {
              type: 'info',
              title: '关于 InsightForge',
              message: 'InsightForge',
              detail: `一个想法 → 5 分钟拿到数据支撑的市场报告\n\nv${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}\nChrome ${process.versions.chrome}`,
              buttons: ['好的'],
              defaultId: 0,
            });
          },
        },
      ],
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * v1.8 P0-A2: 系统托盘(Windows 任务栏 / macOS 菜单栏 / Linux 系统托盘)
 *
 * 单击托盘图标聚焦主窗口,右键打开上下文菜单(显示/隐藏/退出)。
 * 图标文件复用 build/icon.ico;若不存在则跳过托盘(产品体验降级而非崩溃)。
 */
let tray = null;
function setupTray() {
  const iconPath = resolveWindowIcon();
  if (!iconPath || !fs.existsSync(iconPath)) {
    console.warn('[desktop] 未找到图标文件,跳过系统托盘装载');
    return;
  }
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('InsightForge · 一个想法到市场报告 5 分钟');
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          const main = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
          if (main) {
            if (main.isMinimized()) main.restore();
            main.show();
            main.focus();
          }
        },
      },
      {
        label: '新建调研',
        click: () => {
          const main = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
          if (main) {
            if (main.isMinimized()) main.restore();
            main.show();
            main.focus();
            main.webContents.send('desktop:navigate', '/');
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]);
    tray.setContextMenu(contextMenu);
    // Windows / Linux 单击托盘 = 聚焦主窗口
    // macOS 习惯单击 = 上下文菜单(已通过 setContextMenu 提供)
    if (process.platform !== 'darwin') {
      tray.on('click', () => {
        const main = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
        if (main) {
          if (main.isMinimized()) main.restore();
          main.show();
          main.focus();
        }
      });
    }
  } catch (err) {
    // 托盘装载失败(常见于 Linux 无系统托盘服务)只警告不崩溃
    console.warn(`[desktop] 系统托盘装载失败: ${err instanceof Error ? err.message : String(err)}`);
    tray = null;
  }
}

/** v1.8 P4-B: 注册自定义协议 insightforge://
 *  让报告分享链接 (`insightforge://report/<projectId>`) 可以从浏览器/聊天软件点击直接拉起桌面应用。
 *  - Windows / Linux: 由 OS 拉起时把 URL 放在 process.argv,需要在 ready 后调一次
 *  - macOS: 通过 'open-url' 事件拿,需在 'will-finish-launching' 之前注册才能捕获冷启动 URL
 */
const INSIGHTFORGE_SCHEME = 'insightforge';
function registerInsightforgeScheme() {
  if (process.defaultApp) {
    // 开发模式: electron . 路径需要传 process.execPath + 入口脚本,否则 OS 找不到
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(INSIGHTFORGE_SCHEME, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(INSIGHTFORGE_SCHEME);
  }
}

/** v1.8 P4-B: 从 insightforge://xxx 中抽路由(path)部分。
 *  返回 null 表示不是有效协议 URL。
 *  示例:
 *    insightforge://report/abc-123   → '/report/abc-123'
 *    insightforge:///history          → '/history'
 *    insightforge://action/new?topic=x → '/action/new?topic=x'
 */
function parseInsightforgeDeepLink(url) {
  if (typeof url !== 'string') return null;
  const prefix = `${INSIGHTFORGE_SCHEME}://`;
  if (!url.startsWith(prefix)) return null;
  // 去掉 scheme://host 部分,host 部分是 host header (例 report / history / discuss)
  // URL.pathname 不包含 host 部分,需手动剥离
  let rest = url.slice(prefix.length);
  // 协议 URL 的 host 不允许包含路径分隔符,但我们的用法是 host = 第一个段、后续 = 路径
  // 例 insightforge://report/abc-123  →  host='report' path='/abc-123'
  //    insightforge://history          →  host='history' path=''
  // 这里拼接为 '/host[/rest]'
  // 简单划分: 找到第一个 '/'
  const slashIdx = rest.indexOf('/');
  let route;
  if (slashIdx < 0) {
    route = `/${rest}`;
  } else {
    route = `/${rest.slice(0, slashIdx)}${rest.slice(slashIdx)}`;
  }
  // 清理可能的多余斜杠
  if (route.length > 1 && route.endsWith('/')) route = route.slice(0, -1);
  // 仅接受以 / 开头的内部路由
  return route.startsWith('/') ? route : null;
}

/** v1.8 P4-B: 在 BrowserWindow 创建后,向渲染进程广播路由跳转 */
function dispatchDeepLinkToRenderer(route) {
  if (!route) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('desktop:navigate', route);
  }
}

/** v1.8 P4-C: 首屏加载窗口
 *  - 窗口尺寸 460x300, 不可关闭(alwaysOnTop), 无菜单
 *  - 加载一个 data: URL 的 HTML(避免依赖外部资源)
 *  - 进度状态通过 webContents.send 推送,前端 JS 更新文字
 *  - 主窗口就绪后调用 closeSplashWindow() 关闭
 */
let splashWindow = null;
let splashReadyResolve = null;
const splashReadyPromise = new Promise((resolve) => { splashReadyResolve = resolve; });

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  const iconPath = resolveWindowIcon();
  const html = buildSplashHtml();
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0F172A',
    title: 'InsightForge',
    icon: iconPath,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // splash HTML 在 data: 域下加载,不需要 preload
    },
  });
  // 拦截外部跳转
  splashWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splashWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  // 页面 DOM ready 后标记 splash JS 已注册 IPC 监听
  splashWindow.webContents.on('did-finish-load', () => {
    splashReadyResolve?.();
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
  });
  splashWindow.loadURL(dataUrl);
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try {
      splashWindow.close();
    } catch (err) {
      console.warn(`[desktop] 关闭 splash 窗口失败: ${err.message}`);
    }
  }
  splashWindow = null;
}

/** v1.8 P4-C: 更新 splash 阶段提示。
 *  阶段: 'starting' | 'backend' | 'openserp' | 'ready'
 */
function updateSplashStage(stage, detail) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  // data URL 不支持 IPC,需要走 webContents.executeJavaScript 直接改 DOM
  const safeDetail = JSON.stringify(detail ?? '');
  const js = `(function(){try{
    const stageEl=document.getElementById('if-stage-text');
    const detailEl=document.getElementById('if-stage-detail');
    const bar=document.getElementById('if-progress-bar');
    const map={starting:1,backend:2,openserp:3,ready:4};
    const pct=map['${stage}']?map['${stage}']*25:0;
    if(stageEl)stageEl.textContent=${JSON.stringify(stageLabel(stage))};
    if(detailEl)detailEl.textContent=${safeDetail};
    if(bar)bar.style.width=pct+'%';
  }catch(e){}})()`;
  splashWindow.webContents.executeJavaScript(js).catch(() => {});
}

function stageLabel(stage) {
  switch (stage) {
    case 'starting': return '启动中';
    case 'backend': return '加载本地后端';
    case 'openserp': return '准备搜索引擎';
    case 'ready': return '就绪';
    default: return '启动中';
  }
}

/** v1.8 P4-C: splash HTML 内容(独立内联,不依赖外部资源) */
function buildSplashHtml() {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8" />
<title>InsightForge</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin:0; padding:0; height:100%; overflow:hidden; }
  body {
    background: radial-gradient(circle at 30% 0%, #1e293b 0%, #0f172a 70%);
    color: #E2E8F0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Microsoft YaHei", sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    -webkit-user-select:none; user-select:none;
  }
  .logo {
    width: 64px; height: 64px; border-radius: 16px;
    background: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
    display:flex; align-items:center; justify-content:center;
    font-size: 32px; font-weight: 700; color: #fff;
    box-shadow: 0 8px 32px rgba(56,189,248,0.35);
    margin-bottom: 18px;
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,100% { transform: scale(1); }
    50% { transform: scale(1.06); }
  }
  h1 { margin:0; font-size:18px; font-weight:600; color:#F1F5F9; letter-spacing:1px;}
  .subtitle { font-size:12px; color:#94A3B8; margin-top:4px; letter-spacing:0.5px;}
  .progress {
    margin-top:24px; width: 320px; height: 4px; background: rgba(148,163,184,0.18);
    border-radius: 999px; overflow:hidden;
  }
  #if-progress-bar {
    height:100%; width:0%; background: linear-gradient(90deg, #38bdf8, #6366f1);
    border-radius: 999px; transition: width 0.35s ease-out;
  }
  .stage { margin-top:12px; font-size:13px; color:#E2E8F0; }
  .stage-detail { margin-top:4px; font-size:11px; color:#64748B; min-height:14px;}
  .hint { position:absolute; bottom:12px; right:14px; font-size:10px; color:#475569;}
</style>
</head><body>
  <div class="logo">IF</div>
  <h1>InsightForge</h1>
  <div class="subtitle">一个想法 → 5 分钟拿到市场报告</div>
  <div class="progress"><div id="if-progress-bar"></div></div>
  <div class="stage" id="if-stage-text">启动中</div>
  <div class="stage-detail" id="if-stage-detail">正在装载本地资源…</div>
  <div class="hint">v1.8</div>
</body></html>`;
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
    autoHideMenuBar: false,
    show: false, // v1.8 P4-C: 首屏 loading 窗口准备好后再 show,避免空白闪烁
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

  // v1.8 P4-B: 注册自定义协议 insightforge://
  registerInsightforgeScheme();

  // v1.8 P4-C: 先弹首屏 loading 窗口,避免主窗口背景色闪烁
  createSplashWindow();
  updateSplashStage('starting', '准备进程…');

  // 统一下载处理: 报告 / 开发文档 / 落地页等文件保存
  // (商业计划书不再走 HTTP 下载,改为走 IPC save-dir 弹目录对话框另存)
  setupDownloadHandler();

  // v1.8 P0-A1/A2: 装载原生应用菜单 + 快捷键 + 系统托盘
  // 必须在 createWindow 之前调用 setApplicationMenu,否则首帧菜单栏闪烁
  setupApplicationMenu();
  setupTray();

  // v1.8 P4-C: splash 阶段切换 - 后端启动
  updateSplashStage('backend', '装载本地后端…');
  // 不死等 splash 加载,3s 超时后强制推进后端启动(避免网络受限导致 loading 窗口卡住)
  await Promise.race([
    splashReadyPromise,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  const entry = resolveBackendEntry();
  if (!fs.existsSync(entry)) {
    updateSplashStage('ready', '未检测到后端, 进入资源未就绪页');
    closeSplashWindow();
    showResourceNotReadyPage('后端入口文件未找到, 请先构建桌面版资源。');
    return;
  }

  const handle = startBackend();
  if (!handle) {
    closeSplashWindow();
    return;
  }
  backendProc = handle.child;

  // v1.8 P4-C: 监听后端日志,看是否启动 OpenSerp
  handle.child.stderr?.on('data', () => updateSplashStage('backend', '后端初始化中…'));
  handle.child.stdout?.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (/openserp|OPENSERP/i.test(text)) updateSplashStage('openserp', '准备搜索引擎容器…');
  });

  try {
    const port = await waitBackendReady(handle.child);
    console.log(`[desktop] 后端就绪, 端口=${port}`);
    updateSplashStage('ready', '即将进入主界面…');

    // 主窗口准备好后再关闭 splash,避免主窗口空白闪烁
    createWindow(port);
    // 等主窗口首次 paint 再关闭 splash
    await new Promise((resolve) => {
      if (!mainWindow) return resolve();
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', resolve);
      } else {
        resolve();
      }
    });
    // 短延 200ms 避免 splash 关得太突兀,给主窗口一点入场感
    setTimeout(() => {
      mainWindow?.show();
      closeSplashWindow();
    }, 200);

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
    updateSplashStage('ready', `启动失败: ${err.message}`);
    setTimeout(() => {
      closeSplashWindow();
      showResourceNotReadyPage(`后端启动失败: ${err.message}`);
    }, 800);
  }
}

/** v1.8 P4-B: 从 process.argv 中找第一个 insightforge:// 开头的 URL(Windows/Linux 单实例复用场景) */
function extractDeepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith(`${INSIGHTFORGE_SCHEME}://`)) {
      return arg;
    }
  }
  return null;
}

// 第二次启动: 主实例收到本实例的 argv 携带的深链,转发给 BrowserWindow 处理
// (复用 v1.7+ 已有的单实例锁, 不重复调用 requestSingleInstanceLock)
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const deepLink = extractDeepLinkFromArgv(argv);
  if (deepLink) {
    const route = parseInsightforgeDeepLink(deepLink);
    if (route) dispatchDeepLinkToRenderer(route);
  }
});

// v1.8 P4-B: macOS 冷启动 / 热启动深链
app.on('open-url', (event, url) => {
  event.preventDefault();
  const route = parseInsightforgeDeepLink(url);
  if (!route) return;
  // app 已 ready 才能向 BrowserWindow 推送,否则先暂存到 bootstrap
  if (app.isReady() && mainWindow) {
    dispatchDeepLinkToRenderer(route);
  } else {
    // 暂存,在 createWindow 后补发
    pendingDeepLinkRoute = route;
  }
});

/** v1.8 P4-B: 暂存冷启动 deep link(等 BrowserWindow 创建后补发) */
let pendingDeepLinkRoute = null;

app.whenReady().then(bootstrap).then(() => {
  if (pendingDeepLinkRoute) {
    dispatchDeepLinkToRenderer(pendingDeepLinkRoute);
    pendingDeepLinkRoute = null;
  }
  // bootstrap 完成后再扫一遍 argv(Windows 启动时直接附带深链的场景)
  const directLink = extractDeepLinkFromArgv(process.argv);
  if (directLink) {
    const route = parseInsightforgeDeepLink(directLink);
    if (route) dispatchDeepLinkToRenderer(route);
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