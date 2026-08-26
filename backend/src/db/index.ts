/**
 * SQLite 数据库单例
 * 负责初始化连接、建表、导出查询接口
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from './schema.js';

let _db: Database.Database | null = null;

/**
 * 获取数据库实例(单例)
 * 首次调用时确保目录存在并执行建表
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = config.DATABASE_PATH;
  const dbDir = path.dirname(dbPath);

  // 确保数据目录存在
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info({ dbDir }, '创建数据目录');
  }

  logger.info({ dbPath }, '连接 SQLite 数据库');
  _db = new Database(dbPath);

  // 启用外键约束与 WAL 模式(性能更好)
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  // 轻量迁移:旧库的 discussion_sessions 表没有 project_id 字段时补齐。
  // 必须在执行 SCHEMA_SQL 之前完成——SCHEMA_SQL 里的 idx_discussions_project 索引
  // 依赖 project_id 列,若旧表缺列而先建索引会直接崩溃。
  // CREATE TABLE IF NOT EXISTS 不会修改已存在的表,因此需显式 ALTER。
  const hasDiscussionTable = (
    _db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='discussion_sessions'`)
      .get() as { name: string } | undefined
  ) !== undefined;
  if (hasDiscussionTable) {
    const discussionCols = _db
      .prepare(`PRAGMA table_info(discussion_sessions)`)
      .all() as Array<{ name: string }>;
    if (!discussionCols.some((c) => c.name === 'project_id')) {
      _db.exec(`ALTER TABLE discussion_sessions ADD COLUMN project_id TEXT`);
      logger.info('数据库迁移:discussion_sessions 已新增 project_id 字段');
    }
  }

  // 建表(含讨论表 project_id 列与索引;旧库由上方迁移补齐后,CREATE IF NOT EXISTS 均为空操作)
  _db.exec(SCHEMA_SQL);
  _db.exec(FTS_SCHEMA_SQL);

  logger.info('数据库表结构已就绪');
  return _db;
}

/**
 * 关闭数据库(进程退出时调用)
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    logger.info('数据库连接已关闭');
  }
}

// 进程退出时自动关闭
process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});