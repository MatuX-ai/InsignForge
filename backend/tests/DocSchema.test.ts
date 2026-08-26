/**
 * agents/schemas/DocSchema.ts 单元测试
 *
 * 覆盖:
 *   1. FULL_DOC_FILENAMES 包含 10 个预定义文件名,顺序固定
 *   2. MVP_DOC_FILENAMES 包含 8 个预定义文件名,顺序固定
 *   3. DocFileSchema 接受合法的单份文档 (filename + title + content)
 *   4. DocFileSchema 拒绝空字段、过短 content
 *   5. DocsResponseSchema 接受 1~20 份文档
 *   6. DocsResponseSchema 拒绝空 documents 数组
 *   7. DocsResponseSchema 拒绝超过 20 份文档
 */
import { describe, it, expect } from 'vitest';
import {
  FULL_DOC_FILENAMES,
  MVP_DOC_FILENAMES,
  DocFileSchema,
  DocsResponseSchema,
} from '../src/agents/schemas/DocSchema.js';

describe('FULL_DOC_FILENAMES 常量', () => {
  it('恰好 10 个文件名', () => {
    expect(FULL_DOC_FILENAMES).toHaveLength(10);
  });

  it('按 PRD-架构-模块-DB-API-竞品-任务-测试-部署 顺序排列', () => {
    expect(FULL_DOC_FILENAMES).toEqual([
      '00-INDEX.md',
      '01-产品需求文档(PRD).md',
      '02-技术架构设计.md',
      '03-功能模块设计.md',
      '04-数据库设计.md',
      '05-API接口文档.md',
      '06-竞品分析.md',
      '07-开发任务拆分.md',
      '08-测试方案.md',
      '09-部署与运维.md',
    ]);
  });

  it('全部以 .md 结尾', () => {
    for (const f of FULL_DOC_FILENAMES) {
      expect(f.endsWith('.md')).toBe(true);
    }
  });

  it('所有文件名唯一', () => {
    expect(new Set(FULL_DOC_FILENAMES).size).toBe(FULL_DOC_FILENAMES.length);
  });
});

describe('MVP_DOC_FILENAMES 常量', () => {
  it('恰好 8 个文件名', () => {
    expect(MVP_DOC_FILENAMES).toHaveLength(8);
  });

  it('全部以 .md 结尾', () => {
    for (const f of MVP_DOC_FILENAMES) {
      expect(f.endsWith('.md')).toBe(true);
    }
  });

  it('所有文件名唯一', () => {
    expect(new Set(MVP_DOC_FILENAMES).size).toBe(MVP_DOC_FILENAMES.length);
  });
});

describe('DocFileSchema', () => {
  it('接受合法文档', () => {
    const result = DocFileSchema.safeParse({
      filename: '00-INDEX.md',
      title: '文档索引',
      content: '# 文档索引\n\n这是项目文档的总览...',
    });
    expect(result.success).toBe(true);
  });

  it('拒绝空 filename', () => {
    const result = DocFileSchema.safeParse({
      filename: '',
      title: 't',
      content: '足够长的内容'.repeat(3),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('filename'))).toBe(true);
    }
  });

  it('拒绝缺失 title 字段', () => {
    const result = DocFileSchema.safeParse({
      filename: 'a.md',
      content: '足够长的内容'.repeat(3),
    });
    expect(result.success).toBe(false);
  });

  it('拒绝 content < 20 字符 (min 校验)', () => {
    const result = DocFileSchema.safeParse({
      filename: 'a.md',
      title: 't',
      content: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join('; ');
      expect(msg).toMatch(/过短/);
    }
  });

  it('接受恰好 20 字符的 content (边界值)', () => {
    const result = DocFileSchema.safeParse({
      filename: 'a.md',
      title: 't',
      content: 'a'.repeat(20),
    });
    expect(result.success).toBe(true);
  });

  it('拒绝 19 字符的 content (边界值)', () => {
    const result = DocFileSchema.safeParse({
      filename: 'a.md',
      title: 't',
      content: 'a'.repeat(19),
    });
    expect(result.success).toBe(false);
  });

  it('接受中文 title + 中文 content', () => {
    const result = DocFileSchema.safeParse({
      filename: '00-INDEX.md',
      title: '文档索引',
      content: '# 文档索引\n\n本目录包含 8 份开发文档,涵盖 PRD、架构、模块、数据库等。',
    });
    expect(result.success).toBe(true);
  });
});

describe('DocsResponseSchema', () => {
  const validDoc = {
    filename: '00-INDEX.md',
    title: 't',
    content: 'a'.repeat(30),
  };

  it('接受恰好 1 份文档 (min 边界)', () => {
    const result = DocsResponseSchema.safeParse({ documents: [validDoc] });
    expect(result.success).toBe(true);
  });

  it('接受 10 份文档 (完整场景)', () => {
    const docs = FULL_DOC_FILENAMES.map((f) => ({
      filename: f,
      title: f,
      content: 'a'.repeat(30),
    }));
    const result = DocsResponseSchema.safeParse({ documents: docs });
    expect(result.success).toBe(true);
  });

  it('接受 20 份文档 (max 边界)', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({
      filename: `${String(i).padStart(2, '0')}-file.md`,
      title: `Doc ${i}`,
      content: 'a'.repeat(30),
    }));
    const result = DocsResponseSchema.safeParse({ documents: docs });
    expect(result.success).toBe(true);
  });

  it('拒绝 21 份文档 (max 边界)', () => {
    const docs = Array.from({ length: 21 }, (_, i) => ({
      filename: `${String(i).padStart(2, '0')}-file.md`,
      title: `Doc ${i}`,
      content: 'a'.repeat(30),
    }));
    const result = DocsResponseSchema.safeParse({ documents: docs });
    expect(result.success).toBe(false);
  });

  it('拒绝空 documents 数组', () => {
    const result = DocsResponseSchema.safeParse({ documents: [] });
    expect(result.success).toBe(false);
  });

  it('拒绝缺失 documents 字段', () => {
    const result = DocsResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('拒绝非法嵌套 (documents 非数组)', () => {
    const result = DocsResponseSchema.safeParse({ documents: 'not array' });
    expect(result.success).toBe(false);
  });

  it('拒绝单份文档字段不合法', () => {
    const result = DocsResponseSchema.safeParse({
      documents: [
        {
          filename: 'a.md',
          title: 't',
          content: 'short', // < 20 字符
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});