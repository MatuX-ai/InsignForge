/**
 * Vitest 配置 - 后端单元测试
 *
 * 关注范围:
 *   - tests/zip.test.ts                手写 ZIP 编码器的安全断言 + CRC32 正确性
 *   - tests/DocSchema.test.ts          开发文档 JSON schema 校验
 *   - tests/DocService.test.ts         DocService.trigger 去重 + 状态查询
 *   - tests/schemaPrompt.test.ts       zod → JSON Schema → prompt 片段
 *   - tests/retryMetrics.test.ts       重试率指标聚合
 *   - tests/reliability.test.ts        可靠性基座(retry/cache/breaker/metrics)
 *   - tests/dedupe.test.ts             URL 归一化与去重合并
 *   - tests/Aggregator.test.ts         聚合器集成(并发 / 部分源失败 / 去重)
 *   - tests/health.test.ts             健康检查路由
 *
 * 设计:
 *   - node 环境 (无 DOM)
 *   - 全局 setup 不引入 DB / LLM,所有副作用通过 vi.mock 隔离
 *   - 覆盖率统计核心 LLM 工具链 / DocService / search/ 可靠性模块;
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
        'src/services/llm/schemaPrompt.ts',
        'src/services/llm/retryMetrics.ts',
        // v1.3:多源采集引擎可靠性模块(路线图阶段 1.4)
        'src/services/search/reliability.ts',
        'src/services/search/dedupe.ts',
        'src/services/search/Aggregator.ts',
      ],
      // search/ 模块验收门槛(路线图阶段 1.4):lines 80
      // 其余模块保持 60,逐步过渡
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
      },
    },
  },
});