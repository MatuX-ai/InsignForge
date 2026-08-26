/**
 * 开发文档生成结果 Zod Schema
 * 用于校验 LLM 输出的文档结构
 *
 * 设计:
 *   - 支持两种版本: mvp (精简版,8份) / full (完整版,10份)
 *   - filename 是预定义的枚举 (与 prompt 严格对齐)
 *   - content 是 Markdown 纯文本
 */
import { z } from 'zod';

/** 完整版 10 份文档的标准文件名 */
export const FULL_DOC_FILENAMES = [
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
] as const;

/** MVP 版 8 份文档的标准文件名 (聚焦 MVP 交付) */
export const MVP_DOC_FILENAMES = [
  '00-INDEX.md',
  '01-MVP产品需求文档(PRD).md',
  '02-技术架构设计.md',
  '03-核心功能模块设计.md',
  '04-数据库设计.md',
  '05-API接口文档.md',
  '06-MVP开发任务拆分.md',
  '07-MVP测试与部署方案.md',
] as const;

/** 文档版本类型 */
export type DocVersion = 'mvp' | 'full';

/** 根据版本获取文件名列表 */
export function getDocFilenames(version: DocVersion): readonly string[] {
  return version === 'mvp' ? MVP_DOC_FILENAMES : FULL_DOC_FILENAMES;
}

export const DocFileSchema = z.object({
  filename: z.string().min(1),
  title: z.string().min(1),
  /** Markdown 内容,允许空段落但不允许完全空白 */
  content: z.string().min(20, '文档内容过短,可能未生成完整'),
});

export const DocsResponseSchema = z.object({
  documents: z.array(DocFileSchema).min(1).max(20),
});

export type ValidatedDocFile = z.infer<typeof DocFileSchema>;
export type ValidatedDocsResponse = z.infer<typeof DocsResponseSchema>;
