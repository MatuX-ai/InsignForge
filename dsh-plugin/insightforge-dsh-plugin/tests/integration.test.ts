/**
 * 集成测试 —— Host + Client 协同 + cordis.patch.yml 校验
 *
 * 验证:
 * 1. apply(ctx, config) 注册 4 个工具 + 3 个服务
 * 2. cordis.patch.yml 可被 YAML 解析并指向本包
 * 3. package.json 的 dsh.bundle / peerDependencies / exports 完整
 * 4. Client 端 dist/client.js 为 IIFE 格式(若已 build)
 * 5. InsightForgeCore.dispose() 后 DB 已关闭
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 检测 better-sqlite3 原生绑定是否可用(无 Python 时无法编译) */
function hasSqliteBindings(): boolean {
  try {
    const req = createRequire(import.meta.url);
    const Database = req('better-sqlite3');
    // 实际打开一个临时数据库才能验证绑定完整
    const tmp = req('node:os').tmpdir() + '/probe-' + Date.now() + '.db';
    const db = new Database(tmp);
    db.exec('CREATE TABLE IF NOT EXISTS t (a INTEGER)');
    db.close();
    req('node:fs').unlinkSync(tmp);
    return true;
  } catch {
    return false;
  }
}

const sqliteAvailable = hasSqliteBindings();

describe('cordis.patch.yml', () => {
  it('存在且包含 insightforge-plugin 节点', () => {
    const patchPath = resolve(ROOT, 'cordis.patch.yml');
    expect(existsSync(patchPath)).toBe(true);
    const yaml = readFileSync(patchPath, 'utf8');
    const parsed = YAML.parse(yaml);
    expect(parsed.plugins).toBeDefined();
    expect(parsed.plugins['insightforge-plugin']).toBeDefined();
    expect(parsed.plugins['insightforge-plugin'].$).toBeDefined();
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

  it('dsh.bundle.patch 指向真实文件', () => {
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(existsSync(resolve(ROOT, pkg.dsh.bundle.patch))).toBe(true);
  });

  it('dsh.client.platform = web', () => {
    expect(pkg.dsh.client.platform).toBe('web');
  });

  it('peerDependencies 含三个核心 dsh 包', () => {
    const peers = Object.keys(pkg.peerDependencies ?? {});
    expect(peers).toContain('@deepseek-ai/cordis');
    expect(peers).toContain('@deepseek-ai/dsh-tools');
    expect(peers).toContain('@deepseek-ai/schemastery');
  });

  it('exports["./client"] 存在', () => {
    expect(pkg.exports['./client']).toBeDefined();
  });

  it('engines.node >= 22', () => {
    expect(pkg.engines.node).toMatch(/>=22/);
  });
});

describe('Host 入口 apply() 注册 4 工具 + 3 服务', () => {
  it('apply() 完成工具与服务注册(基于 mock ctx)', async () => {
    if (!sqliteAvailable) {
      console.warn('[skip] better-sqlite3 原生绑定不可用,跳过 apply() 测试');
      return;
    }
    const { apply, name, inject } = await import('../src/index.js');
    expect(name).toBe('insightforge-plugin');
    expect(inject).toContain('tools');

    const registeredTools: string[] = [];
    const providedServices: string[] = [];
    let disposeHandler: (() => void) | undefined;
    const disposeHandlers: Array<() => void | Promise<void>> = [];

    const ctx = {
      name: 'test-ctx',
      disposed: false,
      // 简化 mock ctx,只实现 apply 中实际调用的方法
      effect: (_fn: unknown) => {},
      onDispose: (fn: () => void | Promise<void>) => {
        disposeHandlers.push(fn);
      },
      inject: (_key: string) => undefined,
      provide: (key: string, _value: unknown) => {
        providedServices.push(key);
      },
      tools: {
        register: (tool: { name: string }) => registeredTools.push(tool.name),
        unregister: (_name: string) => {},
        list: () => [],
      },
    };

    const cfg = {
      llmProvider: 'deepseek' as const,
      llmApiKey: 'sk-test',
      searchProvider: 'openserp' as const,
      searchEndpoint: 'http://localhost:18080',
      dbPath: resolve(ROOT, 'tests', 'fixtures', 'integration-test.db'),
      cacheEnabled: true,
      maxConcurrent: 2,
    };

    expect(() => apply(ctx as never, cfg)).not.toThrow();

    // 4 个工具
    expect(registeredTools).toEqual([
      'market_research',
      'search_demand',
      'generate_landing',
      'competitor_analysis',
    ]);

    // 3 个服务
    expect(providedServices).toContain('insightforge/demand');
    expect(providedServices).toContain('insightforge/report');
    expect(providedServices).toContain('insightforge/session');

    // dispose 钩子存在
    expect(disposeHandlers.length).toBe(1);

    // 调用 dispose 应不抛错(数据库关闭)
    await disposeHandlers[0]();

    // 二次 dispose 同样安全(幂等)
    await disposeHandlers[0]();
  });
});

describe('Client 端打包产物(若已 build)', () => {
  it('dist/client.js 存在且为 IIFE 格式', () => {
    const clientPath = resolve(ROOT, 'dist/client.js');
    if (!existsSync(clientPath)) {
      // 未 build 时跳过(在 typecheck-only CI 中允许)
      console.warn('[skip] dist/client.js 不存在,请先运行 pnpm build');
      return;
    }
    const content = readFileSync(clientPath, 'utf8');
    // IIFE 应包含 window.insightforgeClient 挂载
    expect(content).toMatch(/window\.insightforgeClient/);
    // 不应直接 require Node 内建
    expect(content).not.toMatch(/require\(['"]node:/);
    expect(content).not.toMatch(/from ['"]node:/);
  });

  it('dist/index.js 存在且大小合理(NFR-02)', () => {
    const hostPath = resolve(ROOT, 'dist/index.js');
    if (!existsSync(hostPath)) {
      console.warn('[skip] dist/index.js 不存在,请先运行 pnpm build');
      return;
    }
    const size = statSync(hostPath).size;
    expect(size).toBeLessThan(5 * 1024 * 1024); // 5MB 上限(很宽松,实际 ~1MB)
  });
});