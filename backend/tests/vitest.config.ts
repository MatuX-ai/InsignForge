/**
 * Vitest 配置 - 后端单元测试
 *
 * 关注范围 (本轮覆盖):
 *   - tests/zip.test.ts           手写 ZIP 编码器的安全断言 + CRC32 正确性
 *   - tests/DocSchema.test.ts     开发文档 JSON schema 校验
 *   - tests/DocService.test.ts    DocService.trigger 去重 + 状态查询
 *
 * 设计:
 *   - node 环境 (无 DOM)
 *   - 全局 setup 不引入 DB / LLM,所有副作用通过 vi.mock 隔离
 *   - 覆盖率只统计 src/utils / src/agents/schemas / src/services/DocService.ts
 *     其余 service / api / index 不在本轮审计重点
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 不需要 DOM / browser polyfills
    globals: false,
    // 显式 ms 超时,DocService 的 trigger 是 fire-and-forget,需要时间断言
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/utils/zip.ts',
        'src/agents/schemas/DocSchema.ts',
        'src/services/DocService.ts',
      ],
      // 仅关心真实覆盖率,本轮未覆盖的内部函数允许 0
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
      },
    },
  },
});