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

  // 建表
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