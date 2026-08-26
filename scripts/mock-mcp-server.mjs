#!/usr/bin/env node
/**
 * 模拟 MCP Server —— 用于本地端到端测试"讨论流程中的营销调研工具调用"
 *
 * 实现 MCP stdio 传输(换行分隔的 JSON-RPC 2.0),对 market_research / competitor_analysis
 * 返回固定的示例数据,不依赖真实 OpenSerp / Reddit / LLM / 数据库。
 *
 * 用途:
 *   配合后端环境变量 INSIGHTFORGE_MCP_COMMAND 指向本文件,即可在无需任何搜索基础设施的
 *   情况下,验证"讨论 AI 检索市场数据 → 提炼画布要点"这条 MCP 通道链路。
 *
 * 关键约束:
 *   - stdout 是 MCP 协议流,只能输出 JSON-RPC 消息;日志一律走 stderr。
 *   - 正好也用来验证后端 MCP 客户端的修复行为(stderr 不应被当作失败信号)。
 */
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

// ---------------------------------------------------------------------------
// 固定示例数据(按需改成你想测的领域)
// ---------------------------------------------------------------------------
const MARKET_RESULT = `# 模拟市场调研报告
**调研对象**: AI 健身私教应用
**数据来源**: 模拟数据(mock,非真实检索)

## 市场热度
- 月搜索量(估算): 120000
- 社区讨论量(估算): 8600
- 趋势: rising(上升)
- 综合热度评分: 82/100

## 竞品识别
1. Fitbod - 基于健身科学的个性化训练计划,按次订阅
2. Freeletics - AI 教练 + 社区激励,订阅制
3. Future - 真人教练远程指导,高价订阅
4. Keep - 国内头部健身 App,含 AI 课程

## 用户痛点
- 不知道练什么、怎么练
- 缺乏持续激励,容易放弃
- 线下私教太贵
- 通用计划不适合个体差异

## 市场规模估算
全球在线健身 App 市场约 600 亿美元,AI 个性化健身是增速最快的细分。

## 风险
- 巨头(Keep/Freeletics)竞争激烈
- 用户留存困难

## 机会
- 垂直细分(如产后恢复、中老年)机会大
- 结合可穿戴设备数据的实时反馈是差异化方向`;

const COMPETITOR_RESULT = `# 竞品分析(模拟数据)
领域: AI 健身私教
1. Fitbod: 优势=数据驱动个性化; 不足=无社区/激励
2. Freeletics: 优势=社区+AI教练; 不足=课程深度一般
3. Future: 优势=真人教练; 不足=价格高(约 150 美元/月)
4. Keep: 优势=国内用户基数大; 不足=AI 个性化弱`;

function argOf(msg, key) {
  const a = msg.params?.arguments;
  return a && typeof a === 'object' && typeof a[key] === 'string' ? a[key] : '(未提供)';
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 处理
// ---------------------------------------------------------------------------
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;

  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return; // 忽略非 JSON(例如某些客户端可能夹带非协议内容)
  }

  // 通知类消息: 无需响应
  if (msg.method && msg.method.startsWith('notifications/')) return;

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'insightforge-mock-mcp', version: '1.0.0' },
      },
    });
    return;
  }

  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'market_research',
            description: 'mock: 对产品想法做市场调研',
            inputSchema: {
              type: 'object',
              properties: { idea: { type: 'string' }, depth: { type: 'string' } },
            },
          },
          {
            name: 'competitor_analysis',
            description: 'mock: 扫描竞品画像',
            inputSchema: {
              type: 'object',
              properties: { domain: { type: 'string' }, limit: { type: 'number' } },
            },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    const idea = argOf(msg, 'idea') || argOf(msg, 'domain');
    const text =
      name === 'competitor_analysis'
        ? `**调用参数**: domain=${argOf(msg, 'domain')}\n\n${COMPETITOR_RESULT}`
        : `**调用参数**: idea=${argOf(msg, 'idea')}, depth=${argOf(msg, 'depth')}\n\n${MARKET_RESULT}`;
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{ type: 'text', text }],
        isError: false,
      },
    });
    console.error(`[mock-mcp] tools/call 已处理: ${name} (idea/domain=${idea})`);
    return;
  }

  // 未知方法: 返回错误,避免客户端挂起
  send({
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  });
});

// 启动日志走 stderr —— 同时验证后端"stderr 不应导致 MCP 通道失败"的修复
console.error('[mock-mcp] stdio transport ready');
