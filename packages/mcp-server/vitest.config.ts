import { defineConfig } from 'vitest/config';

/**
 * vitest 配置 —— @insightforge/mcp-server
 *
 * - 测试目录 ./tests，文件名 *.test.ts
 * - 测试期间直接 import SDK 源码（workspace:*）以保证类型与运行行为一致
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});