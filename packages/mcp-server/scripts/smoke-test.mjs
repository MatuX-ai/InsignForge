// smoke test for mcp-server CLI
// 1) 验证缺 API key 时的退出码
// 2) 验证 stdio initialize / tools/list roundtrip

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, '..', 'bin', 'insightforge-mcp.mjs');

async function runNoApiKey() {
  return new Promise((resolveTest) => {
    const env = { ...process.env };
    delete env.INSIGHTFORGE_LLM_API_KEY;
    const child = spawn('node', [cli, '--transport', 'stdio'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolveTest({ code, stderr }));
  });
}

async function runStdioRoundtrip(apiKey) {
  return new Promise((resolveTest) => {
    const env = { ...process.env, INSIGHTFORGE_LLM_API_KEY: apiKey };
    const child = spawn('node', [cli, '--transport', 'stdio'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    let responses = [];
    const lines = [];
    const onLine = (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        responses.push(msg);
      } catch (e) {
        console.error('Failed to parse line:', line);
      }
    };

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const parts = buf.split('\n');
      buf = parts.pop();
      parts.forEach(onLine);
    });

    // 1. initialize
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '0.0.1' },
        },
      }) + '\n',
    );
    // 2. tools/list
    setTimeout(() => {
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n',
      );
    }, 500);

    setTimeout(() => {
      child.kill();
    }, 2500);

    child.on('close', (code) => {
      resolveTest({ code, stderr, responses });
    });
  });
}

async function runHttpHealth(port) {
  return new Promise((resolveTest) => {
    const env = {
      ...process.env,
      INSIGHTFORGE_LLM_API_KEY: 'sk-smoke-test-fake-key',
      INSIGHTFORGE_HTTP_PORT: String(port),
      INSIGHTFORGE_TRANSPORT: 'http',
    };
    const child = spawn('node', [cli, '--transport', 'http', '--port', String(port)], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.stdout.on('data', (d) => (stderr += d.toString()));

    setTimeout(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        const text = await res.text();
        child.kill();
        resolveTest({ ok: res.ok, status: res.status, body: text, stderr });
      } catch (e) {
        child.kill();
        resolveTest({ ok: false, error: String(e), stderr });
      }
    }, 1500);
  });
}

console.log('[smoke 1/3] missing API key (should exit non-zero with clear message)');
const r1 = await runNoApiKey();
console.log(`  exit code = ${r1.code}`);
const hasError = r1.stderr.includes('API_KEY') || r1.stderr.includes('配置错误') || r1.stderr.includes('LLM API');
console.log(`  has API key error message = ${hasError}`);
console.log(r1.code > 0 && hasError ? '  ✓ PASS' : '  ✗ FAIL');

console.log('\n[smoke 2/3] stdio roundtrip (initialize + tools/list)');
const r2 = await runStdioRoundtrip('sk-smoke-test-fake-key');
const initResp = r2.responses.find((r) => r.id === 1);
const toolsResp = r2.responses.find((r) => r.id === 2);
console.log(`  total responses = ${r2.responses.length}`);
console.log(`  initialize response id=${initResp?.id}, has serverInfo=${!!initResp?.result?.serverInfo}`);
console.log(`  tools/list response id=${toolsResp?.id}, tools count=${toolsResp?.result?.tools?.length}`);
const toolNames = (toolsResp?.result?.tools ?? []).map((t) => t.name).join(',');
const expectedTools = ['market_research', 'search_demand', 'generate_landing', 'competitor_analysis'];
const allPresent = expectedTools.every((n) => toolNames.includes(n));
console.log(`  tools: ${toolNames}`);
console.log(r2.responses.length >= 2 && allPresent ? '  ✓ PASS' : '  ✗ FAIL');

console.log('\n[smoke 3/3] HTTP /health endpoint');
const port = 53127 + Math.floor(Math.random() * 100);
const r3 = await runHttpHealth(port);
console.log(`  status = ${r3.status ?? 'N/A'}`);
console.log(`  body = ${(r3.body ?? '').slice(0, 200)}`);
console.log(r3.ok ? '  ✓ PASS' : '  ✗ FAIL');

console.log('\n=== smoke test done ===');
process.exit(0);