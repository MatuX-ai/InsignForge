/**
 * services/BusinessPlanService.ts 单元测试
 *
 * 覆盖:
 *   1. trigger: 同一 projectId 在 running 中复用现有 job (去重)
 *   2. trigger: 不同 projectId 创建独立 job
 *   3. trigger: failed 后再次 trigger 创建新 job
 *   4. trigger: 报告不存在时 job 进入 failed 状态
 *   5. trigger: 项目不存在时 job 进入 failed 状态
 *   6. trigger: LLM 返回非法 schema → job 进入 failed 状态
 *   7. trigger: LLM 缺失部分文档 → 缺失文档以占位补齐,status 仍为 success
 *   8. getStatus: 不存在时返回 null
 *   9. getZip: 未成功时返回 null
 *   10. reset: 删除指定 projectId 的 job
 *   11. trigger: 12 份文档被正确打包 (ZIP 长度 > 0,EOCD 签名正确)
 *   12. trigger: MISSING_API_KEY 错误码正确传递
 *
 * Mock 策略:
 *   - chatJsonWithSchemaRetry (LLMClient) → vi.fn() 控制返回值(替代 schema 校验与重试层)
 *   - ProjectService.getById → vi.fn() 控制项目查询
 *   - ReportService.getByProjectId → vi.fn() 控制报告查询
 *   - 用 vi.waitFor 等待 fire-and-forget 异步任务完成
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 依赖 (必须在 import BusinessPlanService 之前)
// Services v1.2 调用 chatJsonWithSchemaRetry(自带 schema 校验与重试)。
// 为了让测试既能验证 service 处理逻辑,又不发起真实 LLM 请求,
// 这里直接 mock chatJsonWithSchemaRetry:
//   - 默认 mockResolvedValue 返回受控的 payload
//   - 失败路径用 mockRejectedValue 模拟 schema 校验失败后的报错
// 这样可以保留原有 12 个测试的真实业务意图(包括 "LLM 返回非法 schema" 这个路径)。
vi.mock('../src/services/llm/LLMClient.js', () => ({
  chatJsonWithSchemaRetry: vi.fn(),
}));
vi.mock('../src/services/ProjectService.js', () => ({
  ProjectService: {
    getById: vi.fn(),
  },
}));
vi.mock('../src/services/ReportService.js', () => ({
  ReportService: {
    getByProjectId: vi.fn(),
  },
}));

// 抑制 logger 噪音
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { BusinessPlanService } from '../src/services/BusinessPlanService.js';
import { BP_FILENAMES } from '../src/agents/schemas/BusinessPlanSchema.js';
import { chatJsonWithSchemaRetry } from '../src/services/llm/LLMClient.js';
import { ProjectService } from '../src/services/ProjectService.js';
import { ReportService } from '../src/services/ReportService.js';
import {
  resetMetrics as resetRetryMetrics,
  stopRetryMetricsTimer,
} from '../src/services/llm/retryMetrics.js';

const mockChatJson = chatJsonWithSchemaRetry as unknown as ReturnType<typeof vi.fn>;
const mockProject = ProjectService as unknown as {
  getById: ReturnType<typeof vi.fn>;
};
const mockReport = ReportService as unknown as {
  getByProjectId: ReturnType<typeof vi.fn>;
};

const fakeProject = (id: string) => ({
  id,
  name: `Project ${id}`,
  description: '一款 AI 智能助手产品',
  status: 'completed' as const,
  created_at: '2024-01-01',
});

const fakeReportRecord = (id: string) => ({
  id: `r-${id}`,
  project_id: id,
  report_data: {
    summary: '市场快速增长,机会明确',
    market_heat: { heat_score: 80 },
    competitors: [{ name: '竞品A', description: '头部玩家' }],
    pain_points: ['痛点1', '痛点2'],
  },
  created_at: '2024-01-01',
});

/** 构造 LLM 成功返回的 12 份文档 */
const llmSuccessPayload = () => ({
  documents: BP_FILENAMES.map((filename) => ({
    filename,
    title: filename.replace('.md', ''),
    content: buildMockContent(filename),
  })),
});

/** 为每份文档生成有意义的 mock 内容 */
function buildMockContent(filename: string): string {
  const title = filename.replace('.md', '').replace(/^\d+-/, '');
  return `# ${title}

## 概述

本文档为商业计划书的重要组成部分,详细阐述${title}相关内容。

## 核心要点

### 1. 关键分析

- 基于市场调研数据的合理推演
- 数据支撑充分,逻辑严密
- 符合投资人阅读习惯

### 2. 实施策略

- 短期:快速验证,小步快跑
- 中期:规模化增长,建立壁垒
- 长期:生态化布局,多元收入

### 3. 关键指标

| 指标 | 6 个月 | 12 个月 | 24 个月 |
|------|--------|---------|---------|
| 用户规模 | 1,000 | 50,000 | 500,000 |
| 月营收 | 5 万 | 50 万 | 500 万 |
| 团队规模 | 10 人 | 30 人 | 100 人 |

---

*注:以上数据为基于市场调研报告的合理推演*
`;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRetryMetrics();
  stopRetryMetricsTimer();
  // 默认 mock: 项目存在、报告存在、LLM 返回 12 份合法文档
  mockProject.getById.mockImplementation((id: string) => fakeProject(id));
  mockReport.getByProjectId.mockImplementation((id: string) =>
    fakeReportRecord(id)
  );
  mockChatJson.mockResolvedValue(llmSuccessPayload());
});

afterEach(() => {
  // 清理所有 job,避免测试间污染
  for (const id of ['p1', 'p2', 'p3', 'p-fail', 'p-schema', 'p-missing', 'p-key']) {
    BusinessPlanService.reset(id);
  }
});

describe('BusinessPlanService.trigger - 基本行为', () => {
  it('首次 trigger 立即返回 job (status=running)', () => {
    const job = BusinessPlanService.trigger('p1');
    expect(job.status).toBe('running');
    expect(job.progress).toBe(1);
    expect(job.total).toBe(12);
    expect(job.finished_at).toBeNull();
    expect(job.started_at).toMatch(/T/);
    expect(job.current_step).toMatch(/商业计划书/);
  });

  it('不同 projectId 创建独立 job', () => {
    const jobA = BusinessPlanService.trigger('p1');
    const jobB = BusinessPlanService.trigger('p2');
    expect(jobA).not.toBe(jobB);
    expect(BusinessPlanService.getStatus('p1')).toBe(jobA);
    expect(BusinessPlanService.getStatus('p2')).toBe(jobB);
  });

  it('total 等于 BP_FILENAMES 长度 (12)', () => {
    const job = BusinessPlanService.trigger('p1');
    expect(job.total).toBe(BP_FILENAMES.length);
    expect(BP_FILENAMES.length).toBe(12);
  });
});

describe('BusinessPlanService.trigger - 去重', () => {
  it('同一 projectId 在 running 中复用同一 job (避免重复 LLM 调用)', () => {
    const first = BusinessPlanService.trigger('p1');
    const second = BusinessPlanService.trigger('p1');
    expect(second).toBe(first);
    expect(mockChatJson).toHaveBeenCalledTimes(1);
  });

  it('同一 projectId 在 failed 后再次 trigger 创建新 job', async () => {
    mockProject.getById.mockReturnValueOnce(null); // 第一次失败
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'failed');
    const firstFailed = BusinessPlanService.getStatus('p1');

    // 第二次正常
    const second = BusinessPlanService.trigger('p1');
    expect(second.status).toBe('running');
    expect(second).not.toBe(firstFailed);
    expect(BusinessPlanService.getStatus('p1')).toBe(second);

    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'success');
  });

  it('同一 projectId 在 success 后再次 trigger 创建新 job (允许重新生成)', async () => {
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'success');
    const firstSuccess = BusinessPlanService.getStatus('p1');

    const second = BusinessPlanService.trigger('p1');
    expect(second.status).toBe('running');
    expect(second).not.toBe(firstSuccess);
  });
});

describe('BusinessPlanService.trigger - 错误路径', () => {
  it('项目不存在 → job 失败,error_code=INTERNAL_ERROR', async () => {
    mockProject.getById.mockReturnValue(null);
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'failed');
    const job = BusinessPlanService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/项目不存在/);
  });

  it('报告不存在 → job 失败,error_code=INTERNAL_ERROR', async () => {
    mockReport.getByProjectId.mockReturnValue(null);
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'failed');
    const job = BusinessPlanService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/报告尚未生成/);
  });

  it('LLM 返回非法 schema → job 失败', async () => {
    // 模拟生产环境中 chatJsonWithSchemaRetry 校验失败后抛出的错误：
    //   “LLM 输出未通过 schema 校验(已重试 2 次):...” 与原版业务请求中“结构不符合预期”
    //   同语义(mock 把“结构不符合预期”别名放在 message 中,便于区分错误来源)。
    const err = new Error('LLM 输出未通过 schema 校验(已重试 2 次):documents: 结构不符合预期');
    mockChatJson.mockRejectedValue(err);
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'failed');
    const job = BusinessPlanService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/结构不符合预期/);
  });

  it('LLM 抛异常 → job 失败,error_code=INTERNAL_ERROR', async () => {
    mockChatJson.mockRejectedValue(new Error('LLM API 502'));
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'failed');
    const job = BusinessPlanService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/LLM API 502/);
  });

  it('LLM 抛带 code=MISSING_API_KEY 的错误 → error_code=MISSING_API_KEY', async () => {
    const err = Object.assign(new Error('No API key'), {
      code: 'MISSING_API_KEY',
    });
    mockChatJson.mockRejectedValue(err);
    BusinessPlanService.trigger('p-key');
    await vi.waitFor(() => BusinessPlanService.getStatus('p-key')?.status === 'failed');
    expect(BusinessPlanService.getStatus('p-key')?.error_code).toBe('MISSING_API_KEY');
  });
});

describe('BusinessPlanService.trigger - 成功路径', () => {
  it('LLM 返回 12 份文档 → job 成功,filenames 按 BP_FILENAMES 顺序', async () => {
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'success');
    const job = BusinessPlanService.getStatus('p1');
    expect(job?.progress).toBe(12);
    expect(job?.filenames).toEqual(BP_FILENAMES);
    expect(job?.zip).toBeInstanceOf(Buffer);
    expect((job?.zip?.length ?? 0)).toBeGreaterThan(0);
    expect(job?.finished_at).toMatch(/T/);
    expect(job?.error_code).toBeNull();
    expect(job?.error_message).toBeNull();
  });

  it('LLM 缺失部分文档 → 用占位补齐,status 仍为 success', async () => {
    mockChatJson.mockResolvedValue({
      documents: BP_FILENAMES.slice(0, 7).map((filename) => ({
        filename,
        title: filename,
        content: '# 测试内容\n\n正文段落,内容足够长以满足 schema 校验要求。\n\n',
      })),
    });
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'success');
    const job = BusinessPlanService.getStatus('p1');
    expect(job?.filenames).toEqual(BP_FILENAMES); // 12 份都补齐
    expect(job?.filenames.length).toBe(12);
  });

  it('ZIP 包含正确的 EOCD 签名 (有效 ZIP 文件)', async () => {
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'success');
    const zip = BusinessPlanService.getZip('p1');
    expect(zip).toBeInstanceOf(Buffer);
    // ZIP 文件 EOCD 记录签名: 0x06054b50
    expect(zip!.readUInt32LE(zip!.length - 22)).toBe(0x06054b50);
  });
});

describe('BusinessPlanService.getStatus / getZip / reset', () => {
  it('getStatus: 不存在的 projectId → null', () => {
    expect(BusinessPlanService.getStatus('nonexistent')).toBeNull();
  });

  it('getZip: 不存在的 projectId → null', () => {
    expect(BusinessPlanService.getZip('nonexistent')).toBeNull();
  });

  it('getZip: running 状态 → null (不允许下载未完成的)', () => {
    BusinessPlanService.trigger('p1');
    expect(BusinessPlanService.getZip('p1')).toBeNull();
  });

  it('getZip: failed 状态 → null', async () => {
    mockChatJson.mockRejectedValue(new Error('boom'));
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'failed');
    expect(BusinessPlanService.getZip('p1')).toBeNull();
  });

  it('getZip: success 状态 → 返回 Buffer', async () => {
    BusinessPlanService.trigger('p1');
    await vi.waitFor(() => BusinessPlanService.getStatus('p1')?.status === 'success');
    const zip = BusinessPlanService.getZip('p1');
    expect(zip).toBeInstanceOf(Buffer);
    expect(zip!.length).toBeGreaterThan(100);
  });

  it('reset: 删除指定 projectId 的 job', async () => {
    BusinessPlanService.trigger('p1');
    BusinessPlanService.trigger('p2');
    expect(BusinessPlanService.getStatus('p1')).not.toBeNull();
    BusinessPlanService.reset('p1');
    expect(BusinessPlanService.getStatus('p1')).toBeNull();
    expect(BusinessPlanService.getStatus('p2')).not.toBeNull();
  });

  it('reset 不存在的 projectId → 不抛错', () => {
    expect(() => BusinessPlanService.reset('nonexistent')).not.toThrow();
  });
});

describe('BP_FILENAMES - 文档清单完整性', () => {
  it('包含 12 份文档', () => {
    expect(BP_FILENAMES).toHaveLength(12);
  });

  it('文档编号从 00 到 11 连续', () => {
    const prefixes = BP_FILENAMES.map((f) => f.slice(0, 2));
    const expected = Array.from({ length: 12 }, (_, i) =>
      String(i).padStart(2, '0')
    );
    expect(prefixes).toEqual(expected);
  });

  it('所有文件名都以 .md 结尾', () => {
    expect(BP_FILENAMES.every((f) => f.endsWith('.md'))).toBe(true);
  });

  it('包含关键章节:执行摘要/市场分析/商业模式/财务预测/融资计划/风险分析', () => {
    const names = BP_FILENAMES.join(',');
    expect(names).toContain('执行摘要');
    expect(names).toContain('市场分析');
    expect(names).toContain('商业模式');
    expect(names).toContain('财务预测');
    expect(names).toContain('融资计划');
    expect(names).toContain('风险分析');
  });
});
