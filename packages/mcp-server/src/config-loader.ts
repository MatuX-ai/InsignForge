/**
 * MCP 服务器配置加载
 *
 * 加载顺序（后写覆盖先写）:
 *   1. 内置默认值
 *   2. --config <path> 指定的 JSON / YAML 文件（如果提供）
 *   3. 环境变量 INSIGHTFORGE_*
 *
 * 配置通过 Zod schema 校验，缺失必填字段（llmApiKey）时抛出明确错误。
 *
 * 同时解析：
 * - --transport <stdio|http> 命令行参数
 * - --port <number> HTTP 模式端口
 * - --log-level <level>
 * - --db-path <path>
 * - --help / -h 帮助
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  validateConfig,
  type Config,
  ConfigSchema,
} from '@insightforge/core';

import { logger } from './logger.js';

/** 支持的传输模式 */
export type TransportMode = 'stdio' | 'http';

/** 启动参数解析结果 */
export interface CliArgs {
  configPath?: string;
  transport: TransportMode;
  httpPort: number;
  logLevel: string;
  dbPath?: string;
  showHelp: boolean;
  showVersion: boolean;
}

/** 完整加载结果：CLI 参数 + 最终 Config + 传输模式 */
export interface LoadedMcpConfig {
  config: Config;
  transport: TransportMode;
  httpPort: number;
  args: CliArgs;
}

// ---------- 命令行参数解析 ----------

/**
 * 解析 argv（不依赖 commander/argparse，保持零额外依赖）。
 *
 * 支持的选项：
 *   --config <path>      JSON / YAML 配置文件路径
 *   --transport <mode>   stdio | http
 *   --port <number>      HTTP 模式端口
 *   --log-level <level>  debug | info | warn | error | silent
 *   --db-path <path>     覆盖 dbPath
 *   --help / -h          显示帮助
 *   --version / -v       显示版本
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    configPath: undefined,
    transport: 'stdio',
    httpPort: 3002,
    logLevel: 'info',
    showHelp: false,
    showVersion: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--config':
      case '-c':
        if (!next) throw new McpConfigError('--config 需要一个文件路径参数');
        result.configPath = next;
        i++;
        break;
      case '--transport':
      case '-t':
        if (next !== 'stdio' && next !== 'http') {
          throw new McpConfigError(`--transport 必须是 stdio 或 http，收到 "${next}"`);
        }
        result.transport = next;
        i++;
        break;
      case '--port':
      case '-p': {
        const port = Number(next);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new McpConfigError(`--port 必须是 1-65535 的整数，收到 "${next}"`);
        }
        result.httpPort = port;
        i++;
        break;
      }
      case '--log-level':
      case '-l':
        if (!next) throw new McpConfigError('--log-level 需要一个级别值');
        result.logLevel = next;
        i++;
        break;
      case '--db-path':
        if (!next) throw new McpConfigError('--db-path 需要一个路径');
        result.dbPath = next;
        i++;
        break;
      case '--help':
      case '-h':
        result.showHelp = true;
        break;
      case '--version':
      case '-v':
        result.showVersion = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new McpConfigError(`未知参数 "${arg}"，使用 --help 查看用法`);
        }
    }
  }

  return result;
}

// ---------- 配置文件加载 ----------

const ConfigFileSchema = z
  .object({
    llmProvider: z.string().optional(),
    llmApiKey: z.string().optional(),
    llmBaseUrl: z.string().optional(),
    llmModel: z.string().optional(),
    searchProvider: z.string().optional(),
    searchEndpoint: z.string().optional(),
    dbPath: z.string().optional(),
    cacheEnabled: z.boolean().optional(),
    maxConcurrent: z.number().int().positive().optional(),
    logLevel: z.string().optional(),
  })
  .passthrough();

/**
 * 加载并解析配置文件（支持 .json 与 .yaml/.yml）。
 *
 * YAML 支持仅限于最常见用法（key: value 列表、字符串、数字、布尔、嵌套对象、数组）。
 * 复杂 YAML 特性（锚点、引用、多行块）不在支持范围。
 */
export function loadConfigFile(path: string): z.infer<typeof ConfigFileSchema> {
  const absolutePath = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(absolutePath, 'utf8');
  } catch (err) {
    throw new McpConfigError(
      `无法读取配置文件 "${absolutePath}": ${(err as Error).message}`,
      { cause: err },
    );
  }

  const ext = absolutePath.toLowerCase();
  let parsed: unknown;
  if (ext.endsWith('.json')) {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new McpConfigError(
        `配置文件 JSON 解析失败 "${absolutePath}": ${(err as Error).message}`,
        { cause: err },
      );
    }
  } else if (ext.endsWith('.yaml') || ext.endsWith('.yml')) {
    parsed = parseSimpleYaml(raw);
  } else {
    // 未知名后缀，按 JSON 尝试一次，失败则按 YAML
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = parseSimpleYaml(raw);
    }
  }

  return ConfigFileSchema.parse(parsed);
}

/**
 * 极简 YAML 解析器 —— 仅支持本次配置需要的子集：
 * - key: value（value 为字符串 / 数字 / 布尔 / null）
 * - 缩进表示层级（2 空格）
 * - 列表 `- item`
 * - 注释 `# ...` 与空行
 *
 * 不支持：锚点 / 引用 / 多行字符串 / 复杂转义。
 * 够用即可，避免引入 yaml 包作为依赖。
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '')) // 去掉行尾注释
    .map((l) => l.replace(/\s+$/, '')) // 去尾部空白
    .filter((l) => l.trim().length > 0);

  const root: Record<string, unknown> = {};
  // stack 保存每一层的容器 + 缩进
  const stack: Array<{ indent: number; container: Record<string, unknown> | unknown[] }> = [
    { indent: -1, container: root },
  ];

  for (const line of lines) {
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const content = line.trim();

    // 弹出不再属于本层的栈
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];

    if (content.startsWith('- ')) {
      // 列表项
      const valueText = content.slice(2).trim();
      if (!Array.isArray(top.container)) {
        // 列表根：需要把父容器变成数组（简化：直接报错让用户用嵌套对象）
        throw new McpConfigError(
          `YAML 解析失败：检测到顶层数组但不支持，请改用嵌套对象结构`,
        );
      }
      const item = parseScalar(valueText);
      // 处理 `key: value` 内联形式
      if (valueText.includes(':')) {
        const obj: Record<string, unknown> = {};
        const [k, ...rest] = valueText.split(':');
        obj[k.trim()] = parseScalar(rest.join(':').trim());
        top.container.push(obj);
      } else {
        top.container.push(item);
      }
      continue;
    }

    const colonIdx = content.indexOf(':');
    if (colonIdx < 0) {
      throw new McpConfigError(`YAML 解析失败：缺少冒号的行 "${content}"`);
    }
    const key = content.slice(0, colonIdx).trim();
    const valueText = content.slice(colonIdx + 1).trim();

    if (!Array.isArray(top.container)) {
      if (valueText === '') {
        // 嵌套对象 / 数组的开始 —— 暂存空对象，下一行根据缩进判断
        const child: Record<string, unknown> = {};
        top.container[key] = child;
        stack.push({ indent, container: child });
      } else {
        top.container[key] = parseScalar(valueText);
      }
    } else {
      throw new McpConfigError(`YAML 解析失败：数组中不应有 "${key}:"`);
    }
  }

  return root;
}

function parseScalar(text: string): string | number | boolean | null {
  if (text === '' || text === '~' || text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  // 去引号
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

// ---------- 环境变量读取 ----------

interface EnvOverrides {
  llmProvider?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  searchProvider?: string;
  searchEndpoint?: string;
  dbPath?: string;
  cacheEnabled?: boolean;
  maxConcurrent?: number;
  logLevel?: string;
  transport?: string;
  httpPort?: number;
}

const ENV_KEY_MAP: Record<keyof EnvOverrides, string> = {
  llmProvider: 'INSIGHTFORGE_LLM_PROVIDER',
  llmApiKey: 'INSIGHTFORGE_LLM_API_KEY',
  llmBaseUrl: 'INSIGHTFORGE_LLM_BASE_URL',
  llmModel: 'INSIGHTFORGE_LLM_MODEL',
  searchProvider: 'INSIGHTFORGE_SEARCH_PROVIDER',
  searchEndpoint: 'INSIGHTFORGE_SEARCH_ENDPOINT',
  dbPath: 'INSIGHTFORGE_DB_PATH',
  cacheEnabled: 'INSIGHTFORGE_CACHE_ENABLED',
  maxConcurrent: 'INSIGHTFORGE_MAX_CONCURRENT',
  logLevel: 'INSIGHTFORGE_LOG_LEVEL',
  transport: 'INSIGHTFORGE_TRANSPORT',
  httpPort: 'INSIGHTFORGE_HTTP_PORT',
};

function readEnvOverrides(): EnvOverrides {
  const env = process.env;
  const out: EnvOverrides = {};
  for (const k of Object.keys(ENV_KEY_MAP) as Array<keyof EnvOverrides>) {
    const raw = env[ENV_KEY_MAP[k]];
    if (raw === undefined || raw === '') continue;
    if (k === 'cacheEnabled') {
      out.cacheEnabled = raw === '1' || raw.toLowerCase() === 'true';
    } else if (k === 'maxConcurrent' || k === 'httpPort') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = n;
    } else {
      out[k] = raw;
    }
  }
  return out;
}

// ---------- 合并 + 校验 ----------

/** ConfigFile schema 允许字段 与 Config schema 字段映射 */
function toConfigShape(
  file: Partial<z.infer<typeof ConfigFileSchema>>,
  env: EnvOverrides,
  cli: { dbPath?: string },
): Record<string, unknown> {
  // 优先级：CLI > env > file > (无)
  return {
    llmProvider: env.llmProvider ?? file.llmProvider,
    llmApiKey: env.llmApiKey ?? file.llmApiKey,
    llmBaseUrl: env.llmBaseUrl ?? file.llmBaseUrl,
    llmModel: env.llmModel ?? file.llmModel,
    searchProvider: env.searchProvider ?? file.searchProvider,
    searchEndpoint: env.searchEndpoint ?? file.searchEndpoint,
    dbPath: cli.dbPath ?? env.dbPath ?? file.dbPath,
    cacheEnabled: env.cacheEnabled ?? file.cacheEnabled,
    maxConcurrent: env.maxConcurrent ?? file.maxConcurrent,
    logLevel: env.logLevel ?? file.logLevel,
  };
}

/**
 * 顶层加载入口。
 *
 * @throws McpConfigError 配置缺失 / 非法时抛出，message 直接面向用户
 */
export function loadConfig(argv: string[] = process.argv.slice(2)): LoadedMcpConfig {
  const args = parseCliArgs(argv);

  if (args.showHelp || args.showVersion) {
    return {
      config: validateConfig({ llmApiKey: 'placeholder' }),
      transport: args.transport,
      httpPort: args.httpPort,
      args,
    };
  }

  const file = args.configPath ? loadConfigFile(args.configPath) : {};
  const env = readEnvOverrides();

  // CLI 参数中只有 --db-path 直接覆盖 config.dbPath
  const cliOverrides: { dbPath?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db-path' && argv[i + 1]) {
      cliOverrides.dbPath = argv[i + 1];
      break;
    }
  }

  const configInput = toConfigShape(file, env, cliOverrides);

  // transport / httpPort 从 env / CLI 决定
  const transport: TransportMode =
    (env.transport === 'http' ? 'http' : env.transport === 'stdio' ? 'stdio' : undefined) ??
    args.transport;
  const httpPort = env.httpPort ?? args.httpPort;

  // 必填校验：llmApiKey 必须存在
  if (!configInput.llmApiKey || typeof configInput.llmApiKey !== 'string') {
    throw new McpConfigError(
      '缺少必填配置 INSIGHTFORGE_LLM_API_KEY（可通过环境变量或 --config 配置文件提供）',
    );
  }

  // 用 SDK 的 validateConfig 跑完整校验
  let config: Config;
  try {
    // 过滤 undefined 字段，让 SDK 的默认值生效
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(configInput)) {
      if (v !== undefined) cleaned[k] = v;
    }
    config = validateConfig(cleaned);
  } catch (err) {
    // 重新包装，让错误信息更面向用户
    if (err instanceof Error) {
      throw new McpConfigError(`配置校验失败：${err.message}`, { cause: err });
    }
    throw err;
  }

  logger.info(
    {
      transport,
      httpPort,
      llmProvider: config.llmProvider,
      searchProvider: config.searchProvider,
      dbPath: config.dbPath,
      logLevel: config.logLevel,
    },
    'MCP 配置加载完成',
  );

  return { config, transport, httpPort, args };
}

/**
 * 直接从已有 env 重新构建 Config —— 给 tests / programmatic 使用。
 */
export function buildConfigFromEnv(): Config {
  const env = readEnvOverrides();
  if (!env.llmApiKey) {
    throw new McpConfigError('缺少 INSIGHTFORGE_LLM_API_KEY 环境变量');
  }
  return validateConfig({
    llmProvider: env.llmProvider as Config['llmProvider'] | undefined,
    llmApiKey: env.llmApiKey,
    llmBaseUrl: env.llmBaseUrl,
    llmModel: env.llmModel,
    searchProvider: env.searchProvider as Config['searchProvider'] | undefined,
    searchEndpoint: env.searchEndpoint,
    dbPath: env.dbPath,
    cacheEnabled: env.cacheEnabled,
    maxConcurrent: env.maxConcurrent,
    logLevel: env.logLevel as Config['logLevel'] | undefined,
  });
}

// ---------- 错误类型 ----------

/**
 * 配置加载阶段的统一错误类型。
 *
 * 错误信息直接面向最终用户（CLI 操作员），包含可执行的修复指引。
 */
export class McpConfigError extends Error {
  public readonly code = 'E_CONFIG';
  public readonly cause?: unknown;

  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message);
    this.name = 'McpConfigError';
    this.cause = opts.cause;
  }
}

/**
 * 工具调用执行阶段的错误类型。
 *
 * 不同的 cause 决定不同的错误码前缀，便于客户端按错误码做差异化处理。
 */
export type ToolErrorKind =
  | 'E_LLM_RATE_LIMIT'
  | 'E_LLM_TIMEOUT'
  | 'E_LLM_INVALID_OUTPUT'
  | 'E_LLM_AUTH'
  | 'E_LLM_UNKNOWN'
  | 'E_SEARCH_NETWORK'
  | 'E_SEARCH_EMPTY'
  | 'E_SEARCH_RATE_LIMIT'
  | 'E_DB_NOT_READY'
  | 'E_DB_WRITE'
  | 'E_DB_READ'
  | 'E_CONFIG'
  | 'E_VALIDATION'
  | 'E_INTERNAL';

export class McpToolError extends Error {
  public readonly kind: ToolErrorKind;
  public readonly cause?: unknown;
  /** 脱敏后的可公开上下文（不包含 API Key 等） */
  public readonly context?: Record<string, unknown>;

  constructor(
    kind: ToolErrorKind,
    message: string,
    opts: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    // 构造时就脱敏，避免上层调用者不小心把含敏感字段的 message 直接送到 MCP 客户端
    super(sanitizePublicMessage(message));
    this.name = 'McpToolError';
    this.kind = kind;
    this.cause = opts.cause;
    this.context = opts.context;
  }

  /** 用于 MCP 响应的 JSON 序列化（脱敏） */
  toJSON(): { code: ToolErrorKind; message: string; context?: Record<string, unknown> } {
    return {
      code: this.kind,
      message: this.message,
      context: this.context,
    };
  }
}

/**
 * 轻量敏感字段脱敏（仅处理 McpToolError 直接收到的 message）。
 *
 * 与 tools/errors.ts#sanitize() 保持一致,但不依赖额外模块,避免循环引用。
 */
function sanitizePublicMessage(text: string): string {
  let out = text;
  // Bearer 必须先于 sk- 匹配,避免 sk- 被单独的 REDACTED_API_KEY 覆盖掉 Bearer 标记
  out = out.replace(/Bearer\s+[A-Za-z0-9_\-]{16,}/gi, 'Bearer [REDACTED]');
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{16,}\b/g, '[REDACTED_API_KEY]');
  out = out.replace(/([?&])(api_key|access_token|token|key)=([^&\s]+)/gi, '$1$2=[REDACTED]');
  return out;
}

// 重新导出 ConfigSchema 方便外部用户
export { ConfigSchema };
export type { Config };