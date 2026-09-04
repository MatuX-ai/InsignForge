/**
 * 讨论 AI 的营销调研工具执行器
 *
 * 供讨论梳理画布中的 LLM 工具调用使用,支持两条通道:
 *   1. 直连(默认): 复用后端 MarketResearcher 关键词提取 + Aggregator 多源聚合,
 *      把实时搜索/社区数据格式化为纯文本返回给 LLM
 *   2. MCP(可选):  配置 INSIGHTFORGE_MCP_COMMAND 后,通过 stdio 调用
 *      @insightforge/mcp-server 的 market_research / competitor_analysis 工具
 *      (MCP 通道失败时自动回退到直连)
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MarketResearcher } from '../agents/MarketResearcher.js';
import { Aggregator } from './search/Aggregator.js';
import { config, getLlmApiKey } from '../config.js';
import { getSearchProvider } from './SettingsService.js';
import { logger } from '../logger.js';

/** 一次工具执行的结果(供回填给 LLM) */
export interface ResearchToolResult {
  tool: string;
  /** 给 LLM 看的文本结果 */
  text: string;
  /** 数据来源通道: direct / mcp */
  via: 'direct' | 'mcp';
}

/**
 * 免配置冷启动示例数据
 * 当既未配置 MCP 通道、直连搜索源(OpenSerp/SerpAPI)又不可用时,返回该内置示例,
 * 保证"讨论 AI 检索市场数据"功能开箱即用。文本明确标注为示例,避免误导。
 */
function sampleMarketResult(idea: string): string {
  return `# 市场调研(内置示例 · 免配置冷启动)
**调研对象**: ${idea}
**数据来源**: 内置示例数据(未检测到可用的实时搜索源)

## 市场热度
- 综合热度评分: 70/100(示例)
- 趋势: 平稳(示例)

## 竞品识别(示例)
1. 示例竞品 A - 主打通用场景,订阅制
2. 示例竞品 B - 聚焦垂直细分,增值服务
3. 示例竞品 C - 免费+广告变现

## 用户痛点(示例)
- 现有方案成本高、门槛高
- 缺乏个性化,通用方案不适用
- 使用/学习成本高,留存难

## 市场规模估算(示例)
细分市场年规模约数十亿元量级,需真实数据校验。

## 风险与机会(示例)
- 风险: 竞争激烈、获客成本高
- 机会: 垂直细分、差异化功能

## 如何获取真实数据
在「设置」页选择 SerpAPI 并填写 Key(或自托管 OpenSerp),即可获得真实市场数据。`;
}

function sampleCompetitorResult(domain: string): string {
  return `# 竞品分析(内置示例 · 免配置冷启动)
**领域**: ${domain}
**数据来源**: 内置示例数据(未检测到可用的实时搜索源)

## 示例竞品
1. 示例竞品 A: 优势=用户基数大; 不足=非垂直
2. 示例竞品 B: 优势=垂直深耕; 不足=价格高
3. 示例竞品 C: 优势=免费引流; 不足=功能浅

## 如何获取真实竞品
在「设置」页选择 SerpAPI 并填写 Key(或自托管 OpenSerp)后,将返回真实竞品画像。`;
}

/** 把聚合条目格式化为 LLM 友好的纯文本(截断,避免上下文溢出) */
function formatAggregated(
  items: Awaited<ReturnType<typeof Aggregator.aggregate>>,
  idea: string
): string {
  if (items.length === 0) {
    return `针对「${idea}」暂未采集到公开数据,请基于一般行业知识继续探讨,并提醒用户结果缺少实证。`;
  }
  const lines = items.slice(0, 40).map((n, i) => {
    const content = n.content.length > 300 ? `${n.content.slice(0, 300)}...` : n.content;
    return `[${i + 1}] 来源:${n.source} | 互动:${n.engagement} | 作者:${n.author ?? '匿名'}\n   标题:${n.title ?? '(无)'}\n   内容:${content}\n   链接:${n.url ?? '(无)'}`;
  });
  return `针对「${idea}」检索到的公开市场数据(共 ${items.length} 条,展示前 40 条):\n\n${lines.join('\n\n')}`;
}

/** 步骤回调: 在 MCP/直连工具的耗时阶段汇报,供前端 current_step 展示 */
export type StepReporter = (step: string) => void;

/** 直连通道: 关键词提取 → 多源聚合 → 文本化;无任何数据时返回 null(由上层兜底) */
async function directMarketResearch(
  idea: string,
  onStep?: StepReporter
): Promise<string | null> {
  onStep?.('正在提取调研关键词...');
  const kw = await MarketResearcher.extractKeywords(idea);
  onStep?.('正在聚合多源数据(搜索引擎+社区)...');
  const items = await Aggregator.aggregate(kw.keywords);
  if (items.length === 0) return null;
  return formatAggregated(items, idea);
}

/** 直连通道: 竞品扫描(复用市场调研聚合,提示 LLM 从中提炼竞品画像) */
async function directCompetitorAnalysis(
  domain: string,
  onStep?: StepReporter
): Promise<string | null> {
  onStep?.('正在提取领域关键词...');
  const kw = await MarketResearcher.extractKeywords(`${domain} 竞品`);
  onStep?.('正在聚合竞品画像数据...');
  const items = await Aggregator.aggregate(kw.keywords);
  if (items.length === 0) return null;
  const data = formatAggregated(items, `${domain} 竞品`);
  return `${data}\n\n请基于以上数据提炼该领域的竞品名称、定位、优势与不足。`;
}

// ---------------------------------------------------------------------------
// MCP 通道(最小 stdio 客户端,无外部依赖)
// ---------------------------------------------------------------------------

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** 解析命令字符串为 [command, ...args],支持引号(用于 npx -y "pkg" 之类) */
function parseCommand(cmd: string): [string, string[]] {
  const args: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) {
    args.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  const [command, ...rest] = args;
  return [command ?? '', rest];
}

/** 通过 stdio 调用一次 MCP server 工具(每次调用独立拉起进程,简化生命周期) */
async function callMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  onStep?: StepReporter
): Promise<unknown> {
  const cmd = config.INSIGHTFORGE_MCP_COMMAND;
  if (!cmd?.trim()) throw new Error('MCP 通道未配置 INSIGHTFORGE_MCP_COMMAND');
  const [command, args] = parseCommand(cmd);

  // 把当前 LLM/搜索配置透传给 mcp-server(它读取 INSIGHTFORGE_* 环境变量)
  // 不传 INSIGHTFORGE_DB_PATH,让 mcp-server 使用自己的默认独立库,避免与主库并发冲突
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INSIGHTFORGE_LLM_PROVIDER: config.LLM_PROVIDER,
    INSIGHTFORGE_LLM_API_KEY: getLlmApiKey(),
    INSIGHTFORGE_LLM_MODEL: config.LLM_MODEL,
    INSIGHTFORGE_SEARCH_PROVIDER: getSearchProvider(),
    INSIGHTFORGE_SEARCH_ENDPOINT: config.OPENSERP_URL,
    INSIGHTFORGE_CACHE_ENABLED: 'false',
  };

  // 阶段 1: 启动子进程(冷启动依赖多时 30-60s)
  onStep?.('正在启动 MCP 子进程...');

  // Windows 下 npx / node 常以 .cmd 形式存在,Node spawn 不经 shell 无法直接执行,
  // 因此 Windows 平台需开启 shell 模式(其余平台保持直启,避免额外 shell 层)
  const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    windowsHide: true,
    shell: process.platform === 'win32',
  });

  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
  proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

  try {
    // 阶段 2: 初始化握手(JSON-RPC 2.0)
    onStep?.('正在与 MCP 服务器握手...');
    await writeLine(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'insightforge-backend-discussion', version: '1.0.0' },
      },
    });
    await writeLine(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });

    const callId = randomUUID();
    // 阶段 3: 发送工具调用并等待结果(这一步通常最耗时,可能 30s+)
    onStep?.('已发送工具调用,正在等待 MCP 子进程返回(最长 180 秒)...');
    await writeLine(proc, {
      jsonrpc: '2.0',
      id: callId,
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    });

    // 等待响应(限定超时,防止 MCP server 挂起拖慢讨论)
    const result = await waitForResult(proc, callId, 180_000);
    return result;
  } finally {
    proc.kill();
  }
}

function writeLine(proc: ReturnType<typeof spawn>, msg: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const line = `${JSON.stringify(msg)}\n`;
    proc.stdin?.write(line, (err) => (err ? reject(err) : resolve()));
  });
}

function waitForResult(
  proc: ReturnType<typeof spawn>,
  callId: string,
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`MCP 工具调用超时(${timeoutMs / 1000}s)`));
    }, timeoutMs);

    const onData = (d: Buffer) => {
      buffer += d.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg: { id?: string | number; method?: string; error?: { message?: string }; result?: unknown };
        try {
          msg = JSON.parse(line) as typeof msg;
        } catch {
          continue;
        }
        if (msg.id === callId) {
          settled = true;
          cleanup();
          if (msg.error) reject(new Error(`MCP 工具错误:${msg.error.message ?? '未知错误'}`));
          else resolve(msg.result);
          return;
        }
      }
    };

    // spawn 本身失败(如命令不存在 / Windows 下 .cmd 无法执行)时触发
    const onError = (e: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`MCP 进程启动失败:${e.message}`));
    };

    // 未收到响应前进程提前退出(如 mcp-server 因配置缺失退出)时触发
    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`MCP 进程提前退出(code=${code ?? 'null'})`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off('data', onData);
      proc.off('error', onError);
      proc.off('exit', onExit);
    };

    // 注意: 只解析 stdout(协议流);stderr 是 mcp-server 的日志通道(见其 logger),
    // 属于正常输出而非错误,绝不能把它当作失败信号
    proc.stdout?.on('data', onData);
    proc.on('error', onError);
    proc.on('exit', onExit);
  });
}

/** 从 MCP 工具结果中提取纯文本 */
function extractMcpText(result: unknown): string {
  if (
    result &&
    typeof result === 'object' &&
    'content' in result &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const texts = ((result as { content: Array<{ type?: string; text?: string }> }).content)
      .map((c) => (c.type === 'text' && c.text ? c.text : ''))
      .filter(Boolean);
    if (texts.length > 0) return texts.join('\n\n');
  }
  return JSON.stringify(result, null, 2);
}

/** MCP 通道: 调用 market_research 工具 */
async function mcpMarketResearch(idea: string, onStep?: StepReporter): Promise<string> {
  const result = await callMcpTool(
    'market_research',
    { idea, depth: 'quick' },
    onStep
  );
  return extractMcpText(result);
}

/** MCP 通道: 调用 competitor_analysis 工具 */
async function mcpCompetitorAnalysis(
  domain: string,
  onStep?: StepReporter
): Promise<string> {
  const result = await callMcpTool(
    'competitor_analysis',
    { domain, limit: 5 },
    onStep
  );
  return extractMcpText(result);
}

// ---------------------------------------------------------------------------
// 对外入口: 工具名 → 执行
// ---------------------------------------------------------------------------

export const DiscussionResearch = {
  /** 市场调研工具(market_research) */
  async marketResearch(
    idea: string,
    options?: { onStep?: StepReporter }
  ): Promise<ResearchToolResult> {
    const onStep = options?.onStep;
    // 优先走 MCP 通道(若配置);失败自动回退直连
    if (config.INSIGHTFORGE_MCP_COMMAND?.trim()) {
      try {
        onStep?.('调用 MCP 通道进行市场调研...');
        const text = await mcpMarketResearch(idea, onStep);
        return { tool: 'market_research', text, via: 'mcp' };
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'MCP 调研失败,回退直连');
        onStep?.('MCP 通道失败,回退直连检索...');
      }
    }
    // 直连真实检索;无数据时用内置示例兜底(免配置冷启动)
    onStep?.('调用直连通道进行市场调研...');
    const direct = await directMarketResearch(idea, onStep);
    const text = direct ?? sampleMarketResult(idea);
    return { tool: 'market_research', text, via: 'direct' };
  },

  /** 竞品分析工具(competitor_analysis) */
  async competitorAnalysis(
    domain: string,
    options?: { onStep?: StepReporter }
  ): Promise<ResearchToolResult> {
    const onStep = options?.onStep;
    if (config.INSIGHTFORGE_MCP_COMMAND?.trim()) {
      try {
        onStep?.('调用 MCP 通道进行竞品分析...');
        const text = await mcpCompetitorAnalysis(domain, onStep);
        return { tool: 'competitor_analysis', text, via: 'mcp' };
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'MCP 竞品分析失败,回退直连');
        onStep?.('MCP 通道失败,回退直连检索...');
      }
    }
    // 直连真实检索;无数据时用内置示例兜底(免配置冷启动)
    onStep?.('调用直连通道进行竞品分析...');
    const direct = await directCompetitorAnalysis(domain, onStep);
    const text = direct ?? sampleCompetitorResult(domain);
    return { tool: 'competitor_analysis', text, via: 'direct' };
  },
};
