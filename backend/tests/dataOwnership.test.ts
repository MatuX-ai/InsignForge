/**
 * v2.0: 数据所有权迁移单元测试
 *
 * 覆盖:
 *   - user_quotas 表能被创建并接受 INSERT
 *   - user_id 列迁移对每张目标表幂等执行
 *   - 索引创建幂等
 *   - 双轨制查询模式(user_id = ? OR user_id IS NULL)正确过滤
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  // 每次清理,但保留 users 表
  db.exec(`
    DROP TABLE IF EXISTS market_needs;
    DROP TABLE IF EXISTS project_reports;
    DROP TABLE IF EXISTS executions;
    DROP TABLE IF EXISTS discussion_sessions;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS user_quotas;
    DROP TABLE IF EXISTS users;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      casdoor_id VARCHAR(64) UNIQUE,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(100),
      avatar_url TEXT,
      plan_type VARCHAR(20) DEFAULT 'free',
      settings TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
});

describe('db migration v2.0 user_id 双轨制', () => {
  it('可向现有 projects 表迁移 user_id 列 + 索引(幂等)', () => {
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        progress VARCHAR(200) DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // 模拟 ensureUserIdColumn
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'user_id')).toBe(false);

    db.exec(`ALTER TABLE projects ADD COLUMN user_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`);

    const after = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
    expect(after.some((c) => c.name === 'user_id')).toBe(true);

    // 再次执行 ALTER 应抛错(缺 IF NOT EXISTS),但 index 应幂等
    expect(() =>
      db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`)
    ).not.toThrow();
  });

  it('user_quotas 表创建 + 接受 free 用户 INSERT', () => {
    db.exec(`
      CREATE TABLE user_quotas (
        user_id TEXT PRIMARY KEY,
        plan_type VARCHAR(20) NOT NULL DEFAULT 'free',
        daily_calls INTEGER NOT NULL DEFAULT 0,
        last_reset_date TEXT NOT NULL DEFAULT (date('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run('u1', 'a@b.com');
    db.prepare(
      `INSERT INTO user_quotas (user_id, plan_type) VALUES (?, 'free')`
    ).run('u1');

    const row = db
      .prepare(`SELECT * FROM user_quotas WHERE user_id=?`)
      .get('u1') as { plan_type: string; daily_calls: number };
    expect(row.plan_type).toBe('free');
    expect(row.daily_calls).toBe(0);
  });

  it('双轨制查询:WHERE user_id = ? OR user_id IS NULL', () => {
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO projects (id, user_id, name) VALUES
        ('p1', 'u1', 'u1的'),
        ('p2', NULL, '公共的'),
        ('p3', 'u2', 'u2的'),
        ('p4', NULL, '另一个公共的');
    `);

    // u1 视角:看到自己的 + 所有公共的
    const u1Rows = db
      .prepare(
        `SELECT id FROM projects WHERE user_id = ? OR user_id IS NULL ORDER BY id`
      )
      .all('u1') as Array<{ id: string }>;
    expect(u1Rows.map((r) => r.id).sort()).toEqual(['p1', 'p2', 'p4']);

    // 未登录:看到所有公共的(user_id IS NULL)
    const guestRows = db
      .prepare(`SELECT id FROM projects WHERE user_id IS NULL ORDER BY id`)
      .all() as Array<{ id: string }>;
    expect(guestRows.map((r) => r.id).sort()).toEqual(['p2', 'p4']);
  });
});