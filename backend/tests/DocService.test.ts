/**
 * services/DocService.ts 单元测试
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
 *   11. trigger: 同时 10 份文档被正确打包 (ZIP 长度 > 0)
 *
 * Mock 策略:
 *   - chatJson (LLMClient) → vi.fn() 控制返回值
 *   - ProjectService.getById → vi.fn() 控制项目查询
 *   - ReportService.getByProjectId → vi.fn() 控制报告查询
 *   - 用 vi.waitFor 等待 fire-and-forget 异步任务完成
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 依赖 (必须在 import DocService 之前)
// vi.mock 会被 hoisted 到文件顶部
vi.mock('../src/services/llm/LLMClient.js', () => ({
  chatJson: vi.fn(),
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
vi.mock('../src/services/TechSelectionService.js', () => ({
  TechSelectionService: {
    getSelectedPlan: vi.fn(() => null),
  },
}));
vi.mock('../src/services/FrontendDesignService.js', () => ({
  FrontendDesignService: {
    getSelectedPlan: vi.fn(() => null),
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

import { DocService } from '../src/services/DocService.js';
import { FULL_DOC_FILENAMES as DOC_FILENAMES } from '../src/agents/schemas/DocSchema.js';
import { chatJson } from '../src/services/llm/LLMClient.js';
import { ProjectService } from '../src/services/ProjectService.js';
import { ReportService } from '../src/services/ReportService.js';

const mockChatJson = chatJson as unknown as ReturnType<typeof vi.fn>;
const mockProject = ProjectService as unknown as {
  getById: ReturnType<typeof vi.fn>;
};
const mockReport = ReportService as unknown as {
  getByProjectId: ReturnType<typeof vi.fn>;
};

const fakeProject = (id: string) => ({
  id,
  name: `Project ${id}`,
  description: 'desc',
  status: 'completed' as const,
  created_at: '2024-01-01',
});

const fakeReportRecord = (id: string) => ({
  id: `r-${id}`,
  project_id: id,
  report_data: { idea: 'AI 笔记应用' },
  created_at: '2024-01-01',
});

const llmSuccessPayload = () => ({
  documents: DOC_FILENAMES.map((filename) => ({
    filename,
    title: filename,
    content: `# ${filename}\n\n正文段落 1\n\n正文段落 2\n\n`.repeat(2),
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  // 默认 mock: 项目存在、报告存在、LLM 返回 8 份合法文档
  mockProject.getById.mockImplementation((id: string) => fakeProject(id));
  mockReport.getByProjectId.mockImplementation((id: string) =>
    fakeReportRecord(id)
  );
  mockChatJson.mockResolvedValue(llmSuccessPayload());
});

afterEach(() => {
  // 清理所有 job,避免测试间污染
  for (const id of ['p1', 'p2', 'p3', 'p-fail', 'p-schema', 'p-missing']) {
    DocService.reset(id);
  }
});

describe('DocService.trigger - 基本行为', () => {
  it('首次 trigger 立即返回 job (status=running)', () => {
    const job = DocService.trigger('p1');
    expect(job.status).toBe('running');
    // runDocs 是 fire-and-forget 但同步执行到第一个 await (chatJson)
    // 所以返回时 progress 已被设为 1
    expect(job.progress).toBe(1);
    expect(job.total).toBe(10);
    expect(job.finished_at).toBeNull();
    expect(job.started_at).toMatch(/T/);
  });

  it('不同 projectId 创建独立 job', () => {
    const jobA = DocService.trigger('p1');
    const jobB = DocService.trigger('p2');
    expect(jobA).not.toBe(jobB);
    expect(DocService.getStatus('p1')).toBe(jobA);
    expect(DocService.getStatus('p2')).toBe(jobB);
  });
});

describe('DocService.trigger - 去重', () => {
  it('同一 projectId 在 running 中复用同一 job (避免重复 LLM 调用)', () => {
    const first = DocService.trigger('p1');
    const second = DocService.trigger('p1');
    expect(second).toBe(first);
    expect(mockChatJson).toHaveBeenCalledTimes(1);
  });

  it('同一 projectId 在 failed 后再次 trigger 创建新 job', async () => {
    mockProject.getById.mockReturnValueOnce(null); // 让第一次 trigger 失败
    DocService.trigger('p1');
    // 等待异步失败完成
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'failed');
    const firstFailed = DocService.getStatus('p1');

    // 第二次:项目存在 + LLM 正常 → 新 job 对象 (与 firstFailed 不同引用)
    const second = DocService.trigger('p1');
    expect(second.status).toBe('running');
    expect(second).not.toBe(firstFailed); // 新对象
    expect(DocService.getStatus('p1')).toBe(second); // Map 中已是新对象

    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'success');
  });

  it('同一 projectId 在 success 后再次 trigger 创建新 job (允许重新生成)', async () => {
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'success');
    const firstSuccess = DocService.getStatus('p1');

    const second = DocService.trigger('p1');
    expect(second.status).toBe('running');
    expect(second).not.toBe(firstSuccess);
  });
});

describe('DocService.trigger - 错误路径', () => {
  it('项目不存在 → job 失败,error_code=INTERNAL_ERROR', async () => {
    mockProject.getById.mockReturnValue(null);
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'failed');
    const job = DocService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/项目不存在/);
  });

  it('报告不存在 → job 失败,error_code=INTERNAL_ERROR', async () => {
    mockReport.getByProjectId.mockReturnValue(null);
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'failed');
    const job = DocService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/报告尚未生成/);
  });

  it('LLM 返回非法 schema → job 失败', async () => {
    mockChatJson.mockResolvedValue({ documents: [] }); // 违反 min(1)
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'failed');
    const job = DocService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/结构不符合预期/);
  });

  it('LLM 抛异常 → job 失败,error_code=INTERNAL_ERROR', async () => {
    mockChatJson.mockRejectedValue(new Error('LLM API 502'));
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'failed');
    const job = DocService.getStatus('p1');
    expect(job?.error_code).toBe('INTERNAL_ERROR');
    expect(job?.error_message).toMatch(/LLM API 502/);
  });

  it('LLM 抛带 code=MISSING_API_KEY 的错误 → error_code=MISSING_API_KEY', async () => {
    const err = Object.assign(new Error('No API key'), {
      code: 'MISSING_API_KEY',
    });
    mockChatJson.mockRejectedValue(err);
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'failed');
    expect(DocService.getStatus('p1')?.error_code).toBe('MISSING_API_KEY');
  });
});

describe('DocService.trigger - 成功路径', () => {
  it('LLM 返回 10 份文档 → job 成功,filenames 按 DOC_FILENAMES 顺序', async () => {
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'success');
    const job = DocService.getStatus('p1');
    expect(job?.progress).toBe(10);
    expect(job?.filenames).toEqual(DOC_FILENAMES);
    expect(job?.zip).toBeInstanceOf(Buffer);
    expect((job?.zip?.length ?? 0)).toBeGreaterThan(0);
    expect(job?.finished_at).toMatch(/T/);
    expect(job?.error_code).toBeNull();
    expect(job?.error_message).toBeNull();
  });

  it('LLM 缺失部分文档 → 用占位补齐,status 仍为 success', async () => {
    mockChatJson.mockResolvedValue({
      documents: DOC_FILENAMES.slice(0, 5).map((filename) => ({
        filename,
        title: filename,
        content: '# 占位\n\n缺失文档\n\n'.repeat(2),
      })),
    });
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'success');
    const job = DocService.getStatus('p1');
    expect(job?.filenames).toEqual(DOC_FILENAMES); // 10 份都补齐
    expect(job?.filenames.length).toBe(10);
  });
});

describe('DocService.getStatus / getZip / reset', () => {
  it('getStatus: 不存在的 projectId → null', () => {
    expect(DocService.getStatus('nonexistent')).toBeNull();
  });

  it('getZip: 不存在的 projectId → null', () => {
    expect(DocService.getZip('nonexistent')).toBeNull();
  });

  it('getZip: running 状态 → null (不允许下载未完成的)', () => {
    DocService.trigger('p1');
    expect(DocService.getZip('p1')).toBeNull();
  });

  it('getZip: failed 状态 → null', async () => {
    mockChatJson.mockRejectedValue(new Error('boom'));
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'failed');
    expect(DocService.getZip('p1')).toBeNull();
  });

  it('getZip: success 状态 → 返回 Buffer', async () => {
    DocService.trigger('p1');
    await vi.waitFor(() => DocService.getStatus('p1')?.status === 'success');
    const zip = DocService.getZip('p1');
    expect(zip).toBeInstanceOf(Buffer);
    // EOCD 签名
    expect(zip!.readUInt32LE(zip!.length - 22)).toBe(0x06054b50);
  });

  it('reset: 删除指定 projectId 的 job', async () => {
    DocService.trigger('p1');
    DocService.trigger('p2');
    expect(DocService.getStatus('p1')).not.toBeNull();
    DocService.reset('p1');
    expect(DocService.getStatus('p1')).toBeNull();
    expect(DocService.getStatus('p2')).not.toBeNull();
  });

  it('reset 不存在的 projectId → 不抛错', () => {
    expect(() => DocService.reset('nonexistent')).not.toThrow();
  });
});