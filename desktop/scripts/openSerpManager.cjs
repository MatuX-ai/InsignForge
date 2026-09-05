/**
 * 桌面端内嵌 OpenSerp 容器管理(v1.7+)
 *
 * 目标:
 *   桌面端启动时自动拉起 ghcr.io/openserp/openserp:latest 容器,暴露 8080 端口,
 *   让 backend 的 OpenSerpClient 默认就能拿到真实 Google/Bing SERP,而不是 0 命中。
 *
 * 约束与降级策略:
 *   - docker CLI 不存在 / daemon 未响应 → 跳过,backend 走原 0 命中路径
 *   - 容器启动失败 / 镜像拉取超时 → 跳过,不影响 backend 主流程
 *   - 关闭桌面时 docker stop 容器(--rm 自动清理)
 *
 * 国内用户:
 *   OpenSerp 默认调用 Google SERP,国内直连 Google 不可达,OpenSerp 容器能起但搜不到东西。
 *   这种情况属于"基础设施到位但网络受限",本模块无法解决,
 *   用户可通过桌面端 SerpAPI 通道(填 Key)或国内垂直源(zhihu/juejin)拿到部分数据。
 *
 * 设计取舍:
 *   - 用 spawnSync(spawn)直接调 docker CLI,不引入 dockerode 依赖(桌面端尽量少依赖)
 *   - 容器命名固定 insightforge-openserp;--rm 让容器退出即清,不留垃圾
 *   - 镜像拉取用 90s 超时(见 PULL_TIMEOUT_MS),首启动可能慢但不卡 UI
 *   - 启动后用 /search/google 端点轮询就绪,Ready 才算真正生效
 *   - docker CLI 路径优先走 PATH,Windows 上回退到标准 Docker Desktop 安装位置;
 *     极个别奇葩安装路径(非默认盘符 / 自定义目录)请用环境变量 OPENSERP_DOCKER_CLI 覆盖
 */
const { spawn, spawnSync } = require('node:child_process');

const OPEN_SERP_IMAGE = 'ghcr.io/openserp/openserp:latest';
const CONTAINER_NAME = 'insightforge-openserp';
const CONTAINER_PORT = 8080;
const PULL_TIMEOUT_MS = 90_000;     // 镜像拉取上限
const START_TIMEOUT_MS = 15_000;    // docker run 上限
const READY_TIMEOUT_MS = 30_000;    // 容器起来后等 SERP 接口就绪
const DAEMON_PROBE_MS = 5_000;      // docker info 超时

/**
 * 探测 docker CLI 是否存在并可执行。
 * Windows 优先在 PATH 中找,失败回退标准 Docker Desktop 安装路径。
 * @returns {string|null} 可执行的 docker 命令;null 表示找不到。
 */
function findDockerCli() {
  // 优先级: OPENSERP_DOCKER_CLI 环境变量 > PATH > Windows 标准 Docker Desktop 安装位置
  const override = process.env.OPENSERP_DOCKER_CLI?.trim();
  const candidates = override
    ? [override]
    : ['docker.exe', 'docker'];
  if (process.platform === 'win32' && !override) {
    // Docker Desktop for Windows 默认安装位置(用户态 + 机器态)
    candidates.push(
      'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe'
    );
  }
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], {
        stdio: 'ignore',
        timeout: 3000,
        windowsHide: true,
      });
      if (r.status === 0) return c;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/**
 * 探测 docker daemon 是否在运行。Desktop 未启动时这条会超时。
 * @param {string} cli docker CLI 路径
 * @param {number} timeoutMs
 * @returns {boolean}
 */
function checkDaemon(cli, timeoutMs = DAEMON_PROBE_MS) {
  try {
    const r = spawnSync(cli, ['info'], {
      stdio: 'ignore',
      timeout: timeoutMs,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * 检查指定名称的容器是否在运行。
 * @param {string} cli
 * @param {string} name
 * @returns {boolean}
 */
function isContainerRunning(cli, name = CONTAINER_NAME) {
  try {
    const r = spawnSync(
      cli,
      ['ps', '--filter', `name=${name}`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    if (r.status !== 0) return false;
    return r.stdout
      .trim()
      .split(/\r?\n/)
      .includes(name);
  } catch {
    return false;
  }
}

/**
 * 拉取 OpenSerp 镜像(后台,不阻塞启动)。
 * 失败不抛错,记录日志后让 docker run 自己处理(本地已有镜像时直接 run 即可)。
 */
function pullImage(cli, logger = console) {
  return new Promise((resolve) => {
    logger.info?.(`[openserp] 拉取镜像(后台): ${OPEN_SERP_IMAGE}`);
    let pull;
    try {
      pull = spawn(cli, ['pull', OPEN_SERP_IMAGE], {
        stdio: 'pipe',
        windowsHide: true,
      });
    } catch (err) {
      logger.warn?.(`[openserp] 启动拉取失败: ${err.message}`);
      resolve(false);
      return;
    }
    let stderrBuf = '';
    // v1.7+: 镜像拉取进度实时透传。
    // docker pull 输出格式: <id>: <status> <progress> (用 \r 原地刷新同一行)
    // 这里切 \r/\n 取最后一条非空行, 用 2s 节流避免刷屏;
    // 首行与末行(boundary)不节流,保证开始/结果可见。
    let lastEmitAt = 0;
    const emitProgress = (line) => {
      if (!line) return;
      const now = Date.now();
      const isBoundary = stderrBuf.split(/\r?\n/).filter((l) => l.trim()).length <= 1;
      if (isBoundary || now - lastEmitAt >= 2000) {
        logger.info?.(`[openserp] pull: ${line.slice(0, 200)}`);
        lastEmitAt = now;
      }
    };
    pull.stderr?.on('data', (d) => {
      const text = d.toString();
      stderrBuf += text;
      // \r 在 docker pull 里表示 "覆盖当前行", 按 \r/\n 切分取最后一条有效行
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 0) emitProgress(lines[lines.length - 1]);
    });
    pull.stdout?.on('data', (d) => {
      // pull 一般走 stderr,但部分 docker 版本也会用 stdout 输出 digest
      stderrBuf += d.toString();
    });
    pull.on('exit', (code) => {
      if (code === 0) {
        logger.info?.('[openserp] 镜像拉取完成');
        resolve(true);
      } else {
        logger.warn?.(`[openserp] 镜像拉取退出码 ${code}(若本地已有镜像可忽略)`);
        logger.debug?.(`[openserp] stderr: ${stderrBuf.trim().slice(0, 500)}`);
        resolve(false);
      }
    });
    pull.on('error', (err) => {
      logger.warn?.(`[openserp] 拉取进程异常: ${err.message}`);
      resolve(false);
    });
    setTimeout(() => {
      pull.kill();
      logger.warn?.(`[openserp] 拉取超时(${PULL_TIMEOUT_MS}ms),放弃`);
      resolve(false);
    }, PULL_TIMEOUT_MS);
  });
}

/**
 * 启动 OpenSerp 容器(前台同步,等 run 命令返回)。
 * @returns {string|null} 容器 ID;null 表示启动失败。
 */
function runContainer(cli, logger = console) {
  try {
    const r = spawnSync(
      cli,
      [
        'run',
        '-d',
        '--rm',
        '--name', CONTAINER_NAME,
        '-p', `${CONTAINER_PORT}:${CONTAINER_PORT}`,
        OPEN_SERP_IMAGE,
      ],
      { encoding: 'utf8', timeout: START_TIMEOUT_MS, windowsHide: true }
    );
    if (r.status !== 0) {
      logger.warn?.(`[openserp] docker run 失败: ${(r.stderr || '').trim().slice(0, 300)}`);
      return null;
    }
    const cid = (r.stdout || '').trim();
    logger.info?.(`[openserp] 容器已启动, id=${cid.slice(0, 12)}`);
    return cid || CONTAINER_NAME;
  } catch (err) {
    logger.warn?.(`[openserp] docker run 异常: ${err.message}`);
    return null;
  }
}

/**
 * 启动 OpenSerp 容器并等待就绪。
 * 不抛错,任何失败返回 null,调用方据此判断是否启用搜索引擎通道。
 *
 * @param {object} opts
 * @param {Console} [opts.logger] 日志输出(默认 console)
 * @param {boolean} [opts.skipPull] 跳过 docker pull,直接 docker run(节省首启时间)
 * @returns {Promise<
 *   {ok: true, containerName: string, reused: boolean}
 *   | {ok: false, reason: string}
 *   | null
 * >}
 *   - null: 调用参数错误(目前不会出现)
 *   - {ok:false, reason}: 启动失败,reason 是用户可读的具体原因
 *     (例: 'docker CLI 未找到(需 Docker Desktop)' / 'daemon 未响应' / 'run 失败: <stderr前300字符>')
 *   - {ok:true, ...}: 启动成功
 *
 * v1.7+ 返回值上 reason 字段让调用方(main.cjs)能直接向用户透传失败原因,
 *   避免只看到「OpenSerp 未启用」这个高层提示而不知具体卡在哪。
 */
async function startOpenSerpContainer(opts = {}) {
  const logger = opts.logger ?? console;
  const skipPull = opts.skipPull ?? false;

  const cli = findDockerCli();
  if (!cli) {
    const reason = 'docker CLI 未找到(需安装 Docker Desktop 或在 PATH 中提供 docker)';
    logger.warn?.(`[openserp] ${reason},跳过内嵌`);
    return { ok: false, reason };
  }
  if (!checkDaemon(cli)) {
    const reason = 'docker daemon 未响应(请启动 Docker Desktop)';
    logger.warn?.(`[openserp] ${reason},跳过内嵌`);
    return { ok: false, reason };
  }
  if (isContainerRunning(cli)) {
    logger.info?.(`[openserp] 容器 ${CONTAINER_NAME} 已在运行,复用`);
    return { ok: true, containerName: CONTAINER_NAME, reused: true };
  }

  if (!skipPull) {
    await pullImage(cli, logger);
  }
  const cid = runContainer(cli, logger);
  if (!cid) {
    // runContainer 内部已 warn 过具体 stderr, 这里返回通用失败原因
    return { ok: false, reason: 'docker run 失败(具体原因见上面 [openserp] docker run 失败 行)' };
  }
  return { ok: true, containerName: CONTAINER_NAME, reused: false };
}

/**
 * 轮询 OpenSerp 接口直到就绪(或超时)。
 * 成功判断:任意 2xx/4xx 视为 OpenSerp 进程已起来;5xx 表示还在启动中。
 *
 * @param {object} [opts]
 * @param {number} [opts.maxMs]
 * @param {Console} [opts.logger]
 * @param {string} [opts.host]
 * @returns {Promise<boolean>}
 */
async function waitOpenSerpReady(opts = {}) {
  const maxMs = opts.maxMs ?? READY_TIMEOUT_MS;
  const logger = opts.logger ?? console;
  const host = opts.host ?? `http://localhost:${CONTAINER_PORT}`;
  const probeUrl = `${host}/search/google?q=__probe__&engine=google&num=1`;
  const deadline = Date.now() + maxMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(probeUrl, { signal: controller.signal });
        // 任何非 5xx 视为就绪(400 通常表示 query 异常,但进程在跑)
        if (res.status < 500) {
          logger.info?.(`[openserp] 已就绪(第 ${attempt} 次探活)`);
          return true;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      /* 还没起来,继续轮询 */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  logger.warn?.(`[openserp] ${maxMs}ms 内未就绪,搜索引擎通道可能仍不可用`);
  return false;
}

/**
 * 优雅停止 OpenSerp 容器。
 * 用于桌面端关闭时清理;--rm 会让容器自动删除。
 * @param {string} [cli]
 * @param {string} [name]
 */
function stopOpenSerpContainer(cli, name = CONTAINER_NAME) {
  const docker = cli ?? findDockerCli();
  if (!docker) return;
  if (!isContainerRunning(docker, name)) return;
  try {
    spawnSync(docker, ['stop', name], {
      stdio: 'ignore',
      timeout: 15_000,
      windowsHide: true,
    });
  } catch {
    /* 退出路径,吞错 */
  }
}

module.exports = {
  OPEN_SERP_IMAGE,
  CONTAINER_NAME,
  CONTAINER_PORT,
  findDockerCli,
  checkDaemon,
  isContainerRunning,
  pullImage,
  runContainer,
  startOpenSerpContainer,
  waitOpenSerpReady,
  stopOpenSerpContainer,
};