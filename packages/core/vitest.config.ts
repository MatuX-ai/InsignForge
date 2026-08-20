import { defineConfig } from 'vitest/config';

/**
 * vitest 配置 —— @insightforge/core
 *
 * 关键设计:
 * - 复用 SDK 源码目录 ./src,无需额外别名
 * - 测试目录 ./tests,文件名 *.test.ts
 * - better-sqlite3 在无原生绑定的环境下会被 hasSqliteBindings() 跳过相关用例
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
