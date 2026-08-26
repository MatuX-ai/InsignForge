/**
 * 商业计划书生成结果 Zod Schema
 * 用于校验 LLM 输出的 12 份文档结构
 *
 * 设计:
 *   - documents 是固定 12 份文档的有序数组
 *   - filename 是预定义的枚举 (与 prompt 严格对齐)
 *   - content 是 Markdown 纯文本 (不强制语法,LLM 兜底即可)
 */
import { z } from 'zod';

/** 12 份商业计划书文档的标准文件名 (顺序与 prompt 一致) */
export const BP_FILENAMES = [
  '00-封面与目录.md',
  '01-执行摘要.md',
  '02-项目概述.md',
  '03-市场分析.md',
  '04-产品与服务.md',
  '05-商业模式.md',
  '06-营销策略.md',
  '07-运营计划.md',
  '08-团队介绍.md',
  '09-财务预测.md',
  '10-融资计划.md',
  '11-风险分析与应对.md',
] as const;

export type BpFilename = (typeof BP_FILENAMES)[number];

export const BpFileSchema = z.object({
  filename: z.string().min(1),
  title: z.string().min(1),
  /** Markdown 内容,允许空段落但不允许完全空白 */
  content: z.string().min(20, '文档内容过短,可能未生成完整'),
});

export const BpResponseSchema = z.object({
  documents: z.array(BpFileSchema).min(1).max(30),
});

export type ValidatedBpFile = z.infer<typeof BpFileSchema>;
export type ValidatedBpResponse = z.infer<typeof BpResponseSchema>;
