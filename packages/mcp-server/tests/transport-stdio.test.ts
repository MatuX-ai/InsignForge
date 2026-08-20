/**
 * Stdio transport 测试
 *
 * 通过 child_process spawn 启动 CLI 子进程, 走 stdin/stdout roundtrip:
 *   1. 启动 stdio 模式
 *   2. 通过 stdin 发送 MCP initialize / tools/list 请求(JSON
 *   3. 验证 stdout 收到的 JSON-RPC 响应
 *
 * 注意:
 * - 这是端到端测试, 需要先 build(本测试用 tsx 直接跑 src/)
 * - INSIGHTFORGE_LLM_API_KEY 通过环境变量注入(mock key)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const CLI_PATH = resolve(__dirname, '..', 'bin', 'insightforge-mcp.mjs');

/** 启动子进程 stdio 模式 */
function spawnStdio(env: Record<string, string>): ChildProcessWithoutNullStreams {
  return spawn('node', [CLI_PATH], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** 等待子进程 stdout 收到包含 id 的 JSON-RPC 响应 */
function waitForResponse(
  proc: ChildProcessWithoutNullStreams,
  id: number,
  timeoutMs = 5000,
): Promise<unknown> {
  return new Promise((resolveP, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      proc.stdout.off('data', onData);
      reject(new Error(`等待 id=${id} 响应超时, 已收到:\n${buffer}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // MCP over stdio 用换行分隔每条 JSON
      const lines = buffer.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) {
            clearTimeout(timer);
            proc.stdout.off('data', onData);
            resolveP(parsed);
            return;
          }
        } catch {
          /* 忽略不完整行 */
        }
      }
    };
    proc.stdout.on('data', onData);
  });
}

describe('stdio transport (e2e)', () => {
  let proc: ChildProcessWithoutNullStreams;

  beforeAll(() => {
    // 启动一个 stdio 子进程供所有测试复用
    proc = spawnStdio({ INSIGHTFORGE_LLM_API_KEY: 'sk-stdio-test' });
  });

  it('CLI 应能启动并响应 initialize 请求', async () => {
    const initReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
    };
    proc.stdin.write(JSON.stringify(initReq) + '\n');

    const resp: any = await waitForResponse(proc, 1);
    expect(resp.result).toBeDefined();
    expect(resp.result.serverInfo.name).toBe('insightforge');
    expect(resp.result.capabilities).toHaveProperty('tools');
  }, 10_000);

  it('应能列出 4 个工具', async () => {
    const listReq = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };
    proc.stdin.write(JSON.stringify(listReq) + '\n');

    const resp: any = await waitForResponse(proc, 2);
    expect(Array.isArray(resp.result.tools)).toBe(true);
    const names = resp.result.tools.map((t: any) => t.name);
    expect(names).toContain('market_research');
    expect(names).toContain('search_demand');
    expect(names).toContain('generate_landing');
    expect(names).toContain('competitor_analysis');
  }, 10_000);

  it('应能列出 prompts / resources', async () => {
    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'prompts/list', params: {} }) + '\n',
    );
    const prompts: any = await waitForResponse(proc, 3);
    expect(Array.isArray(prompts.result.prompts)).toBe(true);

    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} }) + '\n',
    );
    const resources: any = await waitForResponse(proc, 4);
    expect(Array.isArray(resources.result.resources)).toBe(true);
  }, 10_000);

  it('缺 INSIGHTFORGE_LLM_API_KEY 应以非零码退出并打印错误', async () => {
    // 准备一个明确不包含 LLM_API_KEY 的环境
    const cleanEnv = { ...process.env };
    delete cleanEnv.INSIGHTFORGE_LLM_API_KEY;
    const badProc = spawn('node', [CLI_PATH], {
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 错误信息走 stderr, 退出码非零
    let stderr = '';
    badProc.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    const exitCode: number = await new Promise((res) => badProc.on('exit', res));
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('配置错误');
    expect(stderr).toContain('INSIGHTFORGE_LLM_API_KEY');
  }, 10_000);

  it('应能调用 generate_landing 工具(无需 LLM)', async () => {
    const callReq = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'generate_landing',
        arguments: {
          idea: 'AI 会议纪要',
          value_proposition: '一键总结会议',
          theme: 'light',
        },
      },
    };
    proc.stdin.write(JSON.stringify(callReq) + '\n');

    const resp: any = await waitForResponse(proc, 5);
    expect(resp.result).toBeDefined();
    expect(resp.result.content).toBeDefined();
    expect(resp.result.content.length).toBeGreaterThan(0);
    // 第二个 content 块携带 HTML
    const htmlBlock = resp.result.content.find((c: any) => c.text?.includes('<!DOCTYPE html>'));
    expect(htmlBlock).toBeDefined();
  }, 10_000);
});