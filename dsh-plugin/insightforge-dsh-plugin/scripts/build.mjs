/**
 * 统一的 esbuild 构建脚本 —— Host + Client 双端
 *
 * 用法:
 *   node scripts/build.mjs                # 构建两者
 *   node scripts/build.mjs --target=host  # 仅构建 host
 *   node scripts/build.mjs --target=client # 仅构建 client
 *   node scripts/build.mjs --watch         # 监听模式
 *
 * 设计:
 * - Host → dist/index.js    ESM 格式,Node 22+,保留 .js 扩展名导入
 * - Client → dist/client.js IIFE 格式,浏览器端,挂在 window.insightforgeClient
 */
import { build, context } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const target = getArg('--target') ?? 'all';
const watch = args.includes('--watch');

function getArg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/** 共享 esbuild 选项 */
const SHARED_OPTIONS = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: 'es2022',
};

/** Host 端构建配置(供 Node.js 加载) */
const HOST_CONFIG = {
  ...SHARED_OPTIONS,
  entryPoints: [resolve(ROOT, 'src/index.ts')],
  outfile: resolve(ROOT, 'dist/index.js'),
  platform: 'node',
  format: 'esm',
  // 保留 .js 后缀(我们用 NodeNext 模块解析)
  external: [
    'better-sqlite3',
    'pino',
    'pino-pretty',
    'openai',
    'zod',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/schemastery',
    'node:*',
  ],
  banner: {
    js: `// insightforge-dsh-plugin v${readVersion()} - Host build
// Built at ${new Date().toISOString()}`,
  },
};

/** Client 端构建配置(供浏览器加载,IIFE) */
const CLIENT_CONFIG = {
  ...SHARED_OPTIONS,
  entryPoints: [resolve(ROOT, 'src/client.ts')],
  outfile: resolve(ROOT, 'dist/client.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  // 浏览器不打包 Node 内建
  external: [],
  banner: {
    js: `/* insightforge-dsh-plugin v${readVersion()} - Client (browser) build */
/* Built at ${new Date().toISOString()} */
window.insightforgeClient = `,
  },
  footer: { js: ';' },
  // Client 不需要 cordis/schemastery/dsh-tools 运行时(仅类型)
  // 让 esbuild 把它们 tree-shake 掉
};

function readVersion() {
  const pkg = JSON.parse(
    readFileSync(resolve(ROOT, 'package.json'), 'utf8')
  );
  return pkg.version;
}

async function main() {
  const tasks = [];
  if (target === 'host' || target === 'all') tasks.push(['Host', HOST_CONFIG]);
  if (target === 'client' || target === 'all') tasks.push(['Client', CLIENT_CONFIG]);

  if (tasks.length === 0) {
    console.error(`未知 target: ${target} (应为 host/client/all)`);
    process.exit(1);
  }

  if (watch) {
    for (const [name, config] of tasks) {
      const ctx = await context(config);
      await ctx.watch();
      console.log(`[build] ${name} watching...`);
    }
  } else {
    for (const [name, config] of tasks) {
      console.log(`[build] Building ${name}...`);
      const start = Date.now();
      await build(config);
      console.log(`[build] ${name} done in ${Date.now() - start}ms`);
    }
  }
}

main().catch((err) => {
  console.error('[build] failed:', err);
  process.exit(1);
});