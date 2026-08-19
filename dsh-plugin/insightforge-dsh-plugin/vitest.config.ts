/**
 * Vitest 配置 —— 处理尚未发布的 peerDependencies
 *
 * @deepseek-ai/cordis / @deepseek-ai/dsh-tools / @deepseek-ai/schemastery
 * 在 dsh v0.1 GA 前未发布到 npm,本配置将它们别名到本地 stub 模块,
 * 让测试可以在不安装真实包的情况下运行。
 */
import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // peerDependencies 兜底别名
      '@deepseek-ai/cordis': resolve(ROOT, 'tests/stubs/cordis.ts'),
      '@deepseek-ai/dsh-tools': resolve(ROOT, 'tests/stubs/dsh-tools.ts'),
      '@deepseek-ai/schemastery': resolve(ROOT, 'tests/stubs/schemastery.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 允许跳过找不到的 peer dep(再保险)
    deps: {
      optimizer: {
        web: {
          enabled: false,
        },
      },
    },
  },
});