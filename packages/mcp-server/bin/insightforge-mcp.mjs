#!/usr/bin/env node
/**
 * @insightforge/mcp-server CLI 入口
 *
 * 用法:
 *   insightforge-mcp                              # stdio 模式(默认)
 *   insightforge-mcp --transport http --port 3002 # HTTP+SSE 模式
 *   insightforge-mcp --config ./config.json
 *   insightforge-mcp --help
 *
 * 必须设置环境变量 INSIGHTFORGE_LLM_API_KEY(或 --config 文件中提供)
 */
import process from 'node:process';

import {
  loadConfig,
  parseCliArgs,
  McpConfigError,
  defaultLogger as logger,
  startStdioTransport,
  startHttpTransport,
  createInsightForgeMcpServer,
  VERSION,
  MCP_CAPABILITIES,
} from '../dist/index.js';

import { createInsightForgeCore } from '@insightforge/core';

/** 帮助文本 */
const HELP_TEXT = `
@insightforge/mcp-server v${VERSION}

InsightForge MCP 服务器 —— 暴露 4 个市场调研工具给 Claude Desktop /
Cursor / Cline / Continue 等 MCP 客户端。基于 @insightforge/core SDK。

用法:
  insightforge-mcp [选项]

选项:
  -c, --config <path>       配置文件路径(JSON 或 YAML)
  -t, --transport <mode>    传输模式: stdio(默认) | http
  -p, --port <number>       HTTP 模式监听端口(默认 3002)
  -l, --log-level <level>   日志级别: debug | info | warn | error | silent
      --db-path <path>      覆盖 SQLite 数据库路径
      --help, -h            显示此帮助
      --version, -v         显示版本号

环境变量:
  INSIGHTFORGE_LLM_API_KEY      LLM API Key(必填, 也可放 --config 文件中)
  INSIGHTFORGE_LLM_PROVIDER     deepseek | openai | ollama(默认 deepseek)
  INSIGHTFORGE_LLM_BASE_URL     自定义 LLM Base URL
  INSIGHTFORGE_LLM_MODEL        自定义模型名
  INSIGHTFORGE_SEARCH_PROVIDER  openserp | serpapi(默认 openserp)
  INSIGHTFORGE_SEARCH_ENDPOINT  OpenSerp 地址(默认 http://localhost:18080)
  INSIGHTFORGE_DB_PATH          SQLite 数据库路径
  INSIGHTFORGE_CACHE_ENABLED    true | false(默认 true)
  INSIGHTFORGE_MAX_CONCURRENT   最大并发数(默认 5)
  INSIGHTFORGE_LOG_LEVEL        debug | info | warn | error(默认 info)
  INSIGHTFORGE_TRANSPORT        stdio | http(默认 stdio)
  INSIGHTFORGE_HTTP_PORT        HTTP 模式端口(默认 3002)

工具列表:
  ${MCP_CAPABILITIES.tools.map((t) => `  - ${t}`).join('\n')}
  ...
`.trim();

/**
 * 主入口
 */
async function main() {
  const argv = process.argv.slice(2);
  const args = parseCliArgs(argv);

  if (args.showHelp) {
    process.stderr.write(HELP_TEXT + '\n');
    process.exit(0);
  }

  if (args.showVersion) {
    process.stderr.write(`@insightforge/mcp-server v${VERSION}\n`);
    process.exit(0);
  }

  // 加载配置
  let loaded;
  try {
    loaded = loadConfig(argv);
  } catch (err) {
    const message =
      err instanceof McpConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    process.stderr.write(`\n✗ 配置错误\n\n${message}\n\n${HELP_TEXT}\n`);
    process.exit(2);
  }

  const { config, transport, httpPort, args: cliArgs } = loaded;

  // 调整日志级别
  logger.level = cliArgs.logLevel;

  logger.info(
    {
      version: VERSION,
      transport,
      httpPort,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      dbPath: config.dbPath,
      logLevel: cliArgs.logLevel,
    },
    '启动 @insightforge/mcp-server',
  );

  // 创建 InsightForgeCore(全局单例,所有 transport 共享)
  let core;
  try {
    core = createInsightForgeCore(config);
  } catch (err) {
    logger.fatal({ err }, 'InsightForgeCore 初始化失败');
    process.stderr.write(
      `\n✗ 初始化失败: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  // 健康检查
  const health = core.healthCheck();
  logger.info(health, '健康检查');
  if (!health.ok && health.db === false && !health.llmAvailable) {
    logger.warn('健康检查显示 DB 与 LLM 都不可用, 工具调用可能失败');
  }

  // 注册全局信号处理(优雅退出,MCP-43)
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '收到信号, 开始关闭');
    try {
      core.dispose();
    } catch (err) {
      logger.error({ err }, 'core.dispose() 失败');
    }
    logger.info('已优雅退出');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // 启动对应 transport
  try {
    if (transport === 'stdio') {
      await startStdioTransport(createInsightForgeMcpServer(core), core);
    } else {
      await startHttpTransport(createInsightForgeMcpServer, core, {
        port: httpPort,
      });
      // HTTP 模式下保持进程存活
      await new Promise(() => {
        /* never resolves, 由信号关闭 */
      });
    }
  } catch (err) {
    logger.fatal({ err }, `${transport} transport 启动失败`);
    process.stderr.write(
      `\n✗ ${transport} 启动失败: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    try {
      core.dispose();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `\n✗ 未捕获异常: ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
  );
  process.exit(1);
});