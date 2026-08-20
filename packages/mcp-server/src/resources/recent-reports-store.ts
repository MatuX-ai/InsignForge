/**
 * 最近报告存储 —— 进程内 LRU
 *
 * 用途:支持 `insightforge://reports/recent` resource。
 *
 * 设计:
 * 1. 模块级 Array,容量上限 50,超出后丢弃最早的
 * 2. MCP server 进程内有效,重启后清空(可接受,SDK 未持久化报告元数据)
 * 3. market_research 工具每次成功调用后 push 一条摘要
 * 4. tests 可直接调用 pushRecentReport() / listRecentReports() 验证
 *
 * 不引入第三方 LRU 库:数组 + slice 实现足够简单,容量很小。
 */
import type { ResearchDepth } from '@insightforge/core';

export interface RecentReportSummary {
  /** 调研 sessionId(与 InsightForgeCore.research().sessionId 对齐) */
  projectId: string;
  /** 用户原始 idea */
  idea: string;
  /** 调研深度 */
  depth: ResearchDepth;
  /** 报告生成时间(ISO 字符串) */
  generatedAt: string;
  /** 报告 summary 首句(不超过 280 字符) */
  summary: string;
  /** 命中缓存? */
  fromCache: boolean;
  /** 总耗时 ms */
  durationMs: number;
}

const MAX_RECENT = 50;
const recentReports: RecentReportSummary[] = [];

/**
 * 添加一条报告摘要(超出容量上限时弹出最早的)。
 */
export function pushRecentReport(entry: RecentReportSummary): void {
  recentReports.unshift(entry);
  if (recentReports.length > MAX_RECENT) {
    recentReports.length = MAX_RECENT;
  }
}

/**
 * 获取最近 N 条报告(默认 10)。
 */
export function listRecentReports(limit = 10): RecentReportSummary[] {
  return recentReports.slice(0, Math.max(0, Math.min(limit, MAX_RECENT)));
}

/**
 * 清空(测试用)。
 */
export function clearRecentReports(): void {
  recentReports.length = 0;
}

/**
 * 当前存储条目数(测试 / 监控用)。
 */
export function recentReportsSize(): number {
  return recentReports.length;
}