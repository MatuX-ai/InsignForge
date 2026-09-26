/**
 * InsightforgePackageService 单元测试
 *
 * 覆盖:
 *   1. 导出 → 重新解析后的 manifest / project / report 完全一致(往返一致性)
 *   2. 导入:子表(market_needs / discussions / executions)重新分配 id,project_id 指向新项目
 *   3. 导入:讨论画布内的 group / point id 也被重新分配,避免 id 冲突
 *   4. 解析错误:缺 manifest / schema 不匹配 / ZIP 损坏 → 抛 PackageParseError
 *   5. 导入失败时事务回滚:不会留下半截数据
 *
 * 依赖注入策略:由于 config.DATABASE_PATH 是模块级单例,直接修改 process.env
 * 不会影响已加载的 config。这里采用 vi.mock 把 db 模块整个替换,提供一个
 * 共享的 :memory: better-sqlite3 实例(SCHEMA 与生产一致),让所有 service
 * 走真实 SQL 路径。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';

// 必须在任何 ../src/** 模块加载前完成 vi.mock,否则缓存的 db 引用会绕过 mock
const sharedDb = new Database(':memory:');
sharedDb.pragma('foreign_keys = ON');

vi.mock('../src/db/index.js', () => {
  return {
    getDb: () => sharedDb,
    closeDb: () => {},
  };
});

import {
  buildPackageBuffer,
  parsePackageBuffer,
  importPackage,
  PackageParseError,
  INSIGHTFORGE_PACKAGE_SCHEMA,
} from '../src/services/InsightforgePackageService.js';
import { ProjectService } from '../src/services/ProjectService.js';
import { ReportService } from '../src/services/ReportService.js';
import { MarketNeedService } from '../src/services/MarketNeedService.js';
import { DiscussionService } from '../src/services/DiscussionService.js';
import { ExecutionService } from '../src/services/ExecutionService.js';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from '../src/db/schema.js';

beforeAll(() => {
  // 一次性建表(对应生产 schema)
  sharedDb.exec(SCHEMA_SQL);
  sharedDb.exec(FTS_SCHEMA_SQL);
});

beforeEach(() => {
  // 每个测试前清空数据,保留 schema
  sharedDb.exec(`
    DELETE FROM executions;
    DELETE FROM discussion_sessions;
    DELETE FROM market_needs;
    DELETE FROM project_reports;
    DELETE FROM projects;
  `);
});

afterAll(() => {
  sharedDb.close();
});

describe('buildPackageBuffer + parsePackageBuffer 往返一致性', () => {
  it('仅 project 元数据(无报告/无需求)→ 仍然能打包+解析', () => {
    const project = ProjectService.create({
      name: '裸项目',
      description: '一个没有跑调研的项目',
    });

    const buf = buildPackageBuffer(project.id);
    expect(buf.length).toBeGreaterThan(0);
    // 头 4 字节是 Local File Header 签名
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);

    const payload = parsePackageBuffer(buf);
    expect(payload.manifest.schemaVersion).toBe(INSIGHTFORGE_PACKAGE_SCHEMA);
    expect(payload.manifest.sourceProjectId).toBe(project.id);
    expect(payload.project.name).toBe('裸项目');
    expect(payload.report).toBeNull();
    expect(payload.marketNeeds).toEqual([]);
    expect(payload.discussions).toEqual([]);
    expect(payload.executions).toEqual([]);
  });

  it('含报告 / 市场原始数据 → manifest + report.md 完整保留', () => {
    const project = ProjectService.create({
      name: '宠物饮水机',
      description: '智能宠物饮水机市场调研',
    });
    ProjectService.updateKeywords(project.id, ['宠物', '智能硬件', '饮水机']);

    const report = {
      summary: '市场规模 50 亿元,YoY 25%',
      market_size: '50 亿元',
      competitors: [
        { name: 'Petkit', description: '老牌宠物智能用品' },
      ],
      user_persona: { primary: '25-35 一线城市养猫女性' },
    };
    ReportService.save(project.id, report as never);
    MarketNeedService.bulkInsert([
      {
        content: '猫咪不爱喝水怎么办?',
        source: 'reddit' as const,
        url: 'https://reddit.com/r/cats/123',
        title: 'Cat hydration',
        author: 'cat_lover',
        category: 'pet',
        sentiment_score: 0.8,
        engagement: 42,
        tags: ['cat', 'hydration'],
        project_id: project.id,
      },
    ]);

    const buf = buildPackageBuffer(project.id);
    const payload = parsePackageBuffer(buf);

    expect(payload.project.name).toBe('宠物饮水机');
    expect(payload.project.keywords).toEqual(['宠物', '智能硬件', '饮水机']);
    expect(payload.report).toBeTruthy();
    expect((payload.report as { summary: string }).summary).toBe(
      '市场规模 50 亿元,YoY 25%'
    );
    expect(payload.marketNeeds).toHaveLength(1);
    expect(payload.marketNeeds[0]!.content).toBe('猫咪不爱喝水怎么办?');
  });
});

describe('parsePackageBuffer 校验与错误处理', () => {
  it('完全随机的字节流 → 抛 PackageParseError', () => {
    const random = Buffer.from('this is not a zip at all');
    expect(() => parsePackageBuffer(random)).toThrow(PackageParseError);
  });

  it('过短的 buffer(<22 字节)→ 抛 PackageParseError', () => {
    const tooShort = Buffer.from([0, 1, 2]);
    expect(() => parsePackageBuffer(tooShort)).toThrow(PackageParseError);
  });

  it('缺 manifest.json entry → 抛 PackageParseError', async () => {
    // 用 createZipBuffer 生成一个不含 manifest 的包
    const { createZipBuffer } = await import('../src/utils/zip.js');
    const buf = createZipBuffer([{ path: 'foo.txt', content: 'bar' }]);
    expect(() => parsePackageBuffer(buf)).toThrow(/缺少 entry: manifest\.json/);
  });

  it('manifest schemaVersion 不匹配 → 抛 PackageParseError', async () => {
    const { createZipBuffer } = await import('../src/utils/zip.js');
    const buf = createZipBuffer([
      {
        path: 'manifest.json',
        content: JSON.stringify({
          schemaVersion: '99.0.0',
          generator: 'manual',
          exportedAt: new Date().toISOString(),
          sourceProjectId: 'fake',
          projectName: 'fake',
        }),
      },
      { path: 'project.json', content: '{}' },
      { path: 'market_needs.json', content: '[]' },
      { path: 'discussions.json', content: '[]' },
      { path: 'executions.json', content: '[]' },
    ]);
    expect(() => parsePackageBuffer(buf)).toThrow(/schemaVersion 不匹配/);
  });
});

describe('importPackage 子表 id 重分配', () => {
  it('导入后 project / market_needs / discussions / executions 全部使用新 id', () => {
    // 1. 构造源项目
    const src = ProjectService.create({
      name: '源项目',
      description: '源项目描述',
    });
    ProjectService.updateKeywords(src.id, ['源', '关键词']);
    MarketNeedService.bulkInsert([
      {
        content: '源需求 1',
        source: 'hackernews' as const,
        url: 'https://hn.com/1',
        title: 'HN 1',
        author: 'hn_user',
        category: 'general',
        sentiment_score: 0.5,
        engagement: 10,
        tags: null,
        project_id: src.id,
      },
      {
        content: '源需求 2',
        source: 'reddit' as const,
        url: 'https://reddit.com/2',
        title: 'Reddit 2',
        author: 'reddit_user',
        category: 'general',
        sentiment_score: 0.6,
        engagement: 20,
        tags: ['t1'],
        project_id: src.id,
      },
    ]);
    const discussion = DiscussionService.create({
      title: '源讨论',
      mode: 'free',
      projectId: src.id,
    });
    DiscussionService.applyOps(discussion.id, [
      { op: 'add_group', title: '组 B' },
    ]);
    ExecutionService.create(src.id);

    // 3. 打包
    const buf = buildPackageBuffer(src.id);
    const payload = parsePackageBuffer(buf);

    // 4. 删除源项目后导入,避免 id 重叠
    ProjectService.delete(src.id);
    expect(ProjectService.getById(src.id)).toBeNull();

    // 5. 导入到全新项目
    const newId = importPackage(payload, { namePrefix: '' });
    expect(newId).not.toBe(src.id);
    const newProject = ProjectService.getById(newId);
    expect(newProject).toBeTruthy();
    expect(newProject!.name).toBe('源项目');
    expect(newProject!.keywords).toEqual(['源', '关键词']);

    // 6. market_needs 数量正确 + 内容保留
    const db = sharedDb;
    const needCount = db
      .prepare(`SELECT COUNT(*) as cnt FROM market_needs WHERE project_id = ?`)
      .get(newId) as { cnt: number };
    expect(needCount.cnt).toBe(2);

    // 7. discussions 数量正确
    const newDiscussions = DiscussionService.listByProjectId(newId);
    expect(newDiscussions).toHaveLength(1);
    // 画布中的 group / point id 都已被重新分配
    const groups = newDiscussions[0]!.canvas.groups;
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const allIds = groups.flatMap((g) => [g.id, ...(g.points ?? []).map((p) => p.id)]);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);

    // 8. executions 数量正确
    const execCount = db
      .prepare(`SELECT COUNT(*) as cnt FROM executions WHERE project_id = ?`)
      .get(newId) as { cnt: number };
    expect(execCount.cnt).toBeGreaterThanOrEqual(1);
  });

  it('导入失败时事务回滚:源数据库无残留', () => {
    const src = ProjectService.create({
      name: '正常源项目',
      description: 'desc',
    });
    const buf = buildPackageBuffer(src.id);
    const payload = parsePackageBuffer(buf);

    // 先验证正常路径:项目数 +1
    const before = (sharedDb
      .prepare(`SELECT COUNT(*) as cnt FROM projects`)
      .get() as { cnt: number }).cnt;
    const goodId = importPackage(payload, { namePrefix: '' });
    const afterGood = (sharedDb
      .prepare(`SELECT COUNT(*) as cnt FROM projects`)
      .get() as { cnt: number }).cnt;
    expect(afterGood).toBe(before + 1);
    expect(goodId).toBeTruthy();

    // 错误路径:让 executions.logs 是包含 BigInt 的数组,JSON.stringify 会抛 TypeError,
    // 事务回滚应保证数据库无残留
    const bad = {
      ...payload,
      executions: [
        {
          id: 'x',
          workflow_id: 'w',
          status: 'success' as const,
          current_step: 'x',
          logs: [1n], // 数组里塞 BigInt → JSON.stringify 抛 "Do not know how to serialize a BigInt"
          started_at: new Date().toISOString(),
          finished_at: null,
        },
      ],
    };
    expect(() => importPackage(bad as never)).toThrow();
    const finalCount = (sharedDb
      .prepare(`SELECT COUNT(*) as cnt FROM projects`)
      .get() as { cnt: number }).cnt;
    expect(finalCount).toBe(afterGood);
  });
});

describe('buildPackageBuffer 包含 README 与 manifest', () => {
  it('manifest 含 generator / exportedAt / sourceProjectId / projectName', () => {
    const p = ProjectService.create({ name: '元信息测试', description: 'desc' });
    const buf = buildPackageBuffer(p.id);
    const payload = parsePackageBuffer(buf);
    expect(payload.manifest.generator).toMatch(/insightforge-backend/);
    expect(payload.manifest.exportedAt).toMatch(/T.*Z$/);
    expect(payload.manifest.sourceProjectId).toBe(p.id);
    expect(payload.manifest.projectName).toBe('元信息测试');
  });
});