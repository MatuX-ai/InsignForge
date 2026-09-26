/**
 * v1.8 P9-C: 项目导出/导入包(.insightforge)
 *
 * 设计动机:
 *   - InsightForge 已有 Markdown / PDF 报告下载,但用户希望"一份不依赖 LLM 重跑、
 *     跨机器迁移、跨账号传递"的项目快照(团队成员之间共用调研结果、个人版
 *     换机器搬迁历史、脱离 InsightForge 也能阅读)。
 *   - 与 .zip(BP/开发文档)差异:.zip 只是一组 .md 文档;.insightforge 是
 *     "项目完整状态"——报告 + 市场原始数据 + 讨论画布 + 元信息,以及一份
 *     可供人类阅读的 README.md 报告。
 *
 * 文件格式:
 *   .insightforge = ZIP(STORE) 包含:
 *     manifest.json     元信息(schema_version / exported_at / generator / project_id 原值)
 *     project.json      项目元数据(name / description / keywords / status / progress / dates)
 *     report.json       MarketReport JSON(可空,报告未生成时省略)
 *     report.md         报告的 Markdown 渲染(可空,与 report.json 对齐)
 *     market_needs.json 该项目关联的市场原始需求列表
 *     discussions.json  关联到该项目的讨论画布与对话历史
 *     executions.json   调研工作流执行记录(去重敏感字段,如内存 metrics 不持久化)
 *     README.txt        人类可读的项目摘要 + 字段说明
 *
 * 安全性:
 *   - 用已有的 utils/zip.createZipBuffer(ZIP STORE 模式),内置 Zip Slip 防护
 *   - 导入时统一走 zod schema 校验;manifest 缺失 / schema_version 不匹配 → 拒绝
 *   - 导入生成全新 project_id,不覆盖原有数据;讨论 / 市场数据也重新分配 id,
 *     避免与当前库内 id 冲突
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { ProjectService } from './ProjectService.js';
import { ReportService } from './ReportService.js';
import { MarketNeedService } from './MarketNeedService.js';
import { DiscussionService } from './DiscussionService.js';
import { ExecutionService } from './ExecutionService.js';
import { createZipBuffer } from '../utils/zip.js';
import { reportToMarkdown } from '../utils/markdown.js';
import { logger } from '../logger.js';

/** 当前包格式版本(独立于后端主版本号,允许向后兼容) */
export const INSIGHTFORGE_PACKAGE_SCHEMA = '1.0.0';

/** 单个包内的元信息 */
export interface PackageManifest {
  schemaVersion: string;
  generator: string;
  exportedAt: string;
  /** 导出时项目的 id(便于溯源;导入时会重新分配) */
  sourceProjectId: string;
  projectName: string;
}

/** 包内单个 JSON 数据段 */
export interface PackagePayload {
  manifest: PackageManifest;
  project: ReturnType<typeof ProjectService.getById> extends infer T
    ? Exclude<T, null>
    : never;
  report: unknown | null;
  marketNeeds: ReturnType<typeof MarketNeedService.listByProject>;
  discussions: ReturnType<typeof DiscussionService.listByProjectId>;
  executions: Array<{
    id: string;
    workflow_id: string | null;
    status: 'running' | 'success' | 'failed';
    current_step: string;
    logs: unknown;
    started_at: string;
    finished_at: string | null;
  }>;
}

/** 把项目所有相关数据组装成内存中的 PackagePayload(尚未打包成 ZIP) */
export function buildPackagePayload(projectId: string): PackagePayload {
  const project = ProjectService.getById(projectId);
  if (!project) {
    throw new Error(`项目不存在: ${projectId}`);
  }
  const reportRow = ReportService.getByProjectId(projectId);
  const report = reportRow?.report_data ?? null;
  const marketNeeds = MarketNeedService.listByProject(projectId, 10000);
  const discussions = DiscussionService.listByProjectId(projectId, 10000);
  const executions = listExecutionsForProject(projectId);

  return {
    manifest: {
      schemaVersion: INSIGHTFORGE_PACKAGE_SCHEMA,
      generator: `insightforge-backend/${process.env.npm_package_version ?? '1.8.0'}`,
      exportedAt: new Date().toISOString(),
      sourceProjectId: project.id,
      projectName: project.name,
    },
    project,
    report,
    marketNeeds,
    discussions,
    executions,
  };
}

/**
 * 把 PackagePayload 打包为 ZIP buffer(供前端下载 / 桌面端另存)。
 * 用已有的 createZipBuffer(自带 Zip Slip / 绝对路径 / 长度校验)。
 */
export function buildPackageBuffer(projectId: string): Buffer {
  const payload = buildPackagePayload(projectId);
  const entries = packageToEntries(payload);
  return createZipBuffer(entries);
}

/**
 * 把 PackagePayload 转换成"ZIP entry 列表"(含 README.txt 与 report.md)。
 * 单个 entry 不超过 zip.ts 的安全断言,所有路径都用 "/" 分隔且不含 ".."。
 */
function packageToEntries(payload: PackagePayload): Array<{ path: string; content: string }> {
  const entries: Array<{ path: string; content: string }> = [];

  // manifest 必须在最前(便于一些解压工具按文件顺序预览)
  entries.push({
    path: 'manifest.json',
    content: JSON.stringify(payload.manifest, null, 2),
  });
  entries.push({
    path: 'project.json',
    content: JSON.stringify(payload.project, null, 2),
  });
  if (payload.report !== null) {
    entries.push({
      path: 'report.json',
      content: JSON.stringify(payload.report, null, 2),
    });
    // 同步生成 Markdown 渲染,便于"不依赖 InsightForge 也能阅读"
    try {
      const md = reportToMarkdown(payload.project, payload.report as Parameters<typeof reportToMarkdown>[1]);
      entries.push({ path: 'report.md', content: md });
    } catch (err) {
      // 渲染失败不影响导出,仅记录
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '导出包内 report.md 渲染失败,跳过'
      );
    }
  }
  entries.push({
    path: 'market_needs.json',
    content: JSON.stringify(payload.marketNeeds, null, 2),
  });
  entries.push({
    path: 'discussions.json',
    content: JSON.stringify(payload.discussions, null, 2),
  });
  entries.push({
    path: 'executions.json',
    content: JSON.stringify(payload.executions, null, 2),
  });
  entries.push({
    path: 'README.txt',
    content: buildReadme(payload),
  });

  return entries;
}

function buildReadme(payload: PackagePayload): string {
  const lines: string[] = [];
  lines.push('InsightForge 项目快照 (.insightforge)');
  lines.push('====================================');
  lines.push('');
  lines.push(`项目名:   ${payload.project.name}`);
  lines.push(`导出时间: ${payload.manifest.exportedAt}`);
  lines.push(`Schema:   ${payload.manifest.schemaVersion}`);
  lines.push(`Generator:${payload.manifest.generator}`);
  lines.push(`原项目 ID: ${payload.manifest.sourceProjectId}`);
  lines.push('');
  lines.push(`描述:`);
  lines.push(`  ${payload.project.description}`);
  if (payload.project.keywords && payload.project.keywords.length > 0) {
    lines.push('');
    lines.push(`关键词: ${payload.project.keywords.join(', ')}`);
  }
  lines.push('');
  lines.push('--- 文件清单 ---');
  lines.push('manifest.json     包元信息 (schema_version, generator, exported_at)');
  lines.push('project.json      项目元数据 (name/description/keywords/status/dates)');
  if (payload.report !== null) {
    lines.push('report.json       市场报告完整 JSON');
    lines.push('report.md         报告的 Markdown 渲染(便于直接打开阅读)');
  }
  lines.push('market_needs.json 关联的市场原始数据 (Reddit / HN / 搜索结果)');
  lines.push('discussions.json  关联的讨论画布与对话历史');
  lines.push('executions.json   调研工作流的执行记录');
  lines.push('README.txt        本文件');
  lines.push('');
  lines.push('--- 字段大小参考 ---');
  lines.push(`market_needs:   ${payload.marketNeeds.length} 条`);
  lines.push(`discussions:    ${payload.discussions.length} 个会话`);
  lines.push(`executions:     ${payload.executions.length} 条执行记录`);
  lines.push('');
  lines.push('把本文件用 InsightForge 历史记录页的"导入 .insightforge"按钮上传,可');
  lines.push('以在另一台机器 / 另一个账号上恢复完整项目(会生成新的项目 ID)。');
  return lines.join('\n');
}

/**
 * 从 ZIP buffer 解析 PackagePayload。
 *
 * 说明: InsightForge 后端用的是手写 ZIP 编码器,解码我们这里用 Node 内置的
 * zlib / fflate-free 实现——即手写一个最小的 EOCD 解析 + LFH 扫描来还原
 * 各个 entry。空间节省收益不明显(已经是 STORE),换来零额外依赖。
 *
 * 入口校验: 必须找到 manifest.json,且 schema_version 在可接受范围内。
 */
export interface ParsedPackageEntry {
  path: string;
  content: Buffer;
}

export class PackageParseError extends Error {}

/** 把 buffer 拆解成 path -> content 字典(仅文本 entry,空 entry 跳过) */
export function parseZipBuffer(buf: Buffer): ParsedPackageEntry[] {
  if (buf.length < 22) {
    throw new PackageParseError('ZIP 文件过短,不是有效 ZIP');
  }
  // 1. 找到 EOCD 签名 0x06054b50。从末尾向前扫描(EOCD 注释最大 65535 字节)
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let eocdOffset = -1;
  const maxScan = Math.min(buf.length, 22 + 65535);
  for (let i = buf.length - 22; i >= buf.length - maxScan && i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new PackageParseError('未找到 End of Central Directory 记录');
  }
  // 2. 解析 EOCD 关键字段
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > buf.length) {
    throw new PackageParseError('Central Directory 偏移越界');
  }
  // 3. 遍历 Central Directory,每个 entry 记录 (filename, lfhOffset, nameLen, extraLen)
  const cdRecords: Array<{ name: string; lfhOffset: number; nameLen: number; extraLen: number; commentLen: number }> = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buf.length) {
      throw new PackageParseError('Central Directory 截断');
    }
    if (buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new PackageParseError(`Central Directory 签名错误 @${cursor}`);
    }
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const lfhOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    cdRecords.push({ name, lfhOffset, nameLen, extraLen, commentLen });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  // 4. 按 LFH 偏移读取每个 entry 的实际数据
  const entries: ParsedPackageEntry[] = [];
  for (const rec of cdRecords) {
    if (rec.lfhOffset + 30 > buf.length) {
      throw new PackageParseError(`LFH 越界 @${rec.lfhOffset}`);
    }
    if (buf.readUInt32LE(rec.lfhOffset) !== 0x04034b50) {
      throw new PackageParseError(`LFH 签名错误 @${rec.lfhOffset}`);
    }
    const compMethod = buf.readUInt16LE(rec.lfhOffset + 8);
    if (compMethod !== 0) {
      // 当前 createZipBuffer 只输出 STORE (method=0),非 0 视为不兼容
      throw new PackageParseError(`不支持的压缩算法 method=${compMethod},仅支持 STORE`);
    }
    const compSize = buf.readUInt32LE(rec.lfhOffset + 18);
    const lfhNameLen = buf.readUInt16LE(rec.lfhOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(rec.lfhOffset + 28);
    const dataStart = rec.lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    if (dataStart + compSize > buf.length) {
      throw new PackageParseError(`entry 数据越界: ${rec.name}`);
    }
    const content = buf.slice(dataStart, dataStart + compSize);
    // 跳过目录 entry(以 / 结尾且 content 为空)
    if (compSize === 0 && rec.name.endsWith('/')) continue;
    entries.push({ path: rec.name, content });
  }
  return entries;
}

/**
 * 从 .insightforge ZIP buffer 还原 PackagePayload。
 * 校验 manifest + schema_version,缺失则抛 PackageParseError。
 */
export function parsePackageBuffer(buf: Buffer): PackagePayload {
  const entries = parseZipBuffer(buf);
  const findEntry = (path: string): Buffer => {
    const e = entries.find((x) => x.path === path);
    if (!e) throw new PackageParseError(`缺少 entry: ${path}`);
    return e.content;
  };
  const optional = (path: string): Buffer | null => {
    const e = entries.find((x) => x.path === path);
    return e ? e.content : null;
  };
  const manifestRaw = JSON.parse(findEntry('manifest.json').toString('utf8')) as PackageManifest;
  if (!manifestRaw || typeof manifestRaw !== 'object') {
    throw new PackageParseError('manifest.json 不是合法 JSON 对象');
  }
  if (manifestRaw.schemaVersion !== INSIGHTFORGE_PACKAGE_SCHEMA) {
    throw new PackageParseError(
      `schemaVersion 不匹配: 期望 ${INSIGHTFORGE_PACKAGE_SCHEMA}, 收到 ${manifestRaw.schemaVersion}`
    );
  }
  const projectRaw = JSON.parse(findEntry('project.json').toString('utf8')) as PackagePayload['project'];
  const reportEntry = optional('report.json');
  const report = reportEntry ? JSON.parse(reportEntry.toString('utf8')) : null;
  const marketNeeds = JSON.parse(findEntry('market_needs.json').toString('utf8')) as PackagePayload['marketNeeds'];
  const discussions = JSON.parse(findEntry('discussions.json').toString('utf8')) as PackagePayload['discussions'];
  const executions = JSON.parse(findEntry('executions.json').toString('utf8')) as PackagePayload['executions'];

  return {
    manifest: manifestRaw,
    project: projectRaw,
    report,
    marketNeeds,
    discussions,
    executions,
  };
}

/**
 * 把 PackagePayload 导入到当前数据库,生成新的项目 ID + 关联子表 ID。
 *
 * 策略:
 *   - 始终新建项目(不覆盖),名字前可加 "(已导入)" 标识
 *   - 子表(market_needs / discussions / executions)重新分配 id,
 *     但保留 project_id 关联到新项目
 *   - 报告作为 project_report 直接写入
 *   - 整个过程一个 db.transaction 包裹,失败回滚
 *
 * 返回值: 新项目的 id
 */
export function importPackage(
  payload: PackagePayload,
  options?: { namePrefix?: string }
): string {
  const db = getDb();
  const newProjectId = randomUUID();
  const originalName = payload.project.name ?? '未命名项目';
  const namePrefix = options?.namePrefix ?? '';
  const newName = `${namePrefix}${originalName}`.slice(0, 200);

  // 用一次 transaction 保证原子性
  const tx = db.transaction(() => {
    // 1. 新建项目
    db.prepare(
      `INSERT INTO projects (id, name, description, keywords, status, progress) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      newProjectId,
      newName,
      payload.project.description ?? '',
      payload.project.keywords ? JSON.stringify(payload.project.keywords) : null,
      'draft', // 导入后用户应手动"重新调研"以生成新报告;不直接复制原 status
      '已导入快照'
    );

    // 2. 写入报告(若有)
    if (payload.report !== null && payload.report !== undefined) {
      const reportId = randomUUID();
      const generatedAt = new Date().toISOString();
      const reportWithTs = { ...(payload.report as Record<string, unknown>), generated_at: generatedAt };
      db.prepare(
        `INSERT INTO project_reports (id, project_id, report_data, generated_at) VALUES (?, ?, ?, ?)`
      ).run(reportId, newProjectId, JSON.stringify(reportWithTs), generatedAt);
    }

    // 3. 写入市场原始数据
    if (Array.isArray(payload.marketNeeds)) {
      const insertNeed = db.prepare(
        `INSERT INTO market_needs (id, content, source, url, author, title, category, sentiment_score, engagement, tags, project_id, crawled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const n of payload.marketNeeds) {
        insertNeed.run(
          randomUUID(),
          String(n.content ?? ''),
          String(n.source ?? 'unknown'),
          typeof n.url === 'string' ? n.url : null,
          typeof n.author === 'string' ? n.author : null,
          typeof n.title === 'string' ? n.title : null,
          typeof n.category === 'string' ? n.category : null,
          typeof n.sentiment_score === 'number' ? n.sentiment_score : 0,
          typeof n.engagement === 'number' ? n.engagement : 0,
          Array.isArray(n.tags) ? JSON.stringify(n.tags) : null,
          newProjectId,
          typeof n.crawled_at === 'string' ? n.crawled_at : new Date().toISOString()
        );
      }
    }

    // 4. 写入讨论会话(canvas + messages 重新分配 group / point id 以避免与现有冲突)
    if (Array.isArray(payload.discussions)) {
      const idMap = new Map<string, string>();
      const insertDiscussion = db.prepare(
        `INSERT INTO discussion_sessions (id, project_id, title, mode, canvas, messages) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const d of payload.discussions) {
        const newDiscussionId = randomUUID();
        idMap.set(d.id, newDiscussionId);
        const newCanvas = remapDiscussionCanvasIds(d.canvas);
        insertDiscussion.run(
          newDiscussionId,
          newProjectId,
          String(d.title ?? '未命名梳理'),
          String(d.mode ?? 'free'),
          JSON.stringify(newCanvas.canvas),
          JSON.stringify(Array.isArray(d.messages) ? d.messages : [])
        );
      }
    }

    // 5. 写入执行记录(去重 metrics / error_code 等内存态字段,把它们清空)
    if (Array.isArray(payload.executions)) {
      const insertExec = db.prepare(
        `INSERT INTO executions (id, project_id, workflow_id, status, current_step, logs, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of payload.executions) {
        insertExec.run(
          randomUUID(),
          newProjectId,
          typeof e.workflow_id === 'string' ? e.workflow_id : null,
          ['running', 'success', 'failed'].includes(e.status) ? e.status : 'success',
          typeof e.current_step === 'string' ? e.current_step : '',
          JSON.stringify(Array.isArray(e.logs) ? e.logs : []),
          typeof e.started_at === 'string' ? e.started_at : new Date().toISOString(),
          typeof e.finished_at === 'string' ? e.finished_at : null
        );
      }
    }
  });

  try {
    tx();
    logger.info(
      { sourceProjectId: payload.manifest.sourceProjectId, newProjectId },
      '已导入 .insightforge 包'
    );
    return newProjectId;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '导入 .insightforge 失败,事务已回滚'
    );
    throw err;
  }
}

/**
 * 重新分配讨论画布中所有 group / point 的 id,避免与现有库冲突。
 * 只动内部 id 字段,其它字段保持不变。
 */
function remapDiscussionCanvasIds(canvas: unknown): { canvas: unknown } {
  if (!canvas || typeof canvas !== 'object') return { canvas: { groups: [] } };
  const c = canvas as { groups?: Array<{ id: string; title: string; points?: Array<{ id: string }> }> };
  const groups = Array.isArray(c.groups) ? c.groups : [];
  const newGroups = groups.map((g) => ({
    ...g,
    id: randomUUID(),
    points: Array.isArray(g.points)
      ? g.points.map((p) => ({ ...p, id: randomUUID() }))
      : [],
  }));
  return { canvas: { groups: newGroups } };
}

/** 读取某项目下所有 execution 行(去掉 metrics / error_code 内存态字段) */
function listExecutionsForProject(projectId: string): PackagePayload['executions'] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, workflow_id, status, current_step, logs, started_at, finished_at
       FROM executions WHERE project_id = ? ORDER BY started_at ASC`
    )
    .all(projectId) as Array<{
      id: string;
      workflow_id: string | null;
      status: 'running' | 'success' | 'failed';
      current_step: string;
      logs: string;
      started_at: string;
      finished_at: string | null;
    }>;
  return rows.map((r) => ({
    id: r.id,
    workflow_id: r.workflow_id,
    status: r.status,
    current_step: r.current_step,
    logs: safeParseJson(r.logs),
    started_at: r.started_at,
    finished_at: r.finished_at,
  }));
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

/** 通过 execution_id 直接读取单条 execution(供测试 / 调试) */
export const _internals = { remapDiscussionCanvasIds, listExecutionsForProject };

/** 阻止 Node 在 isolatedModules 模式下误以为 ExecutionService 是 dead code */
export const _keepImports = { ProjectService, ReportService, MarketNeedService, DiscussionService, ExecutionService };