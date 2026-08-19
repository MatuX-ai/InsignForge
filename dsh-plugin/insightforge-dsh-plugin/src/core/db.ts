/**
 * SQLite 数据库封装(基于 better-sqlite3)
 *
 * 设计:
 * 1. 单例,首次 getDb() 时自动建表
 * 2. WAL + foreign_keys + synchronous=NORMAL,与 backend 保持一致
 * 3. closeDb() 由 ctx.effect 注册到 Cordis 生命周期(NFR-04)
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../config-types.js';
import { logger } from '../logger.js';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from './db-schema.js';

let _db: Database.Database | null = null;

/**
 * 获取数据库实例(单例)
 * 首次调用时确保目录存在并执行建表
 */
export function getDb(config: Config): Database.Database {
  if (_db) return _db;

  const dbPath = path.isAbsolute(config.dbPath)
    ? config.dbPath
    : path.resolve(process.cwd(), config.dbPath);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info({ dbDir }, '创建数据目录');
  }

  logger.info({ dbPath }, '连接 SQLite 数据库');
  _db = new Database(dbPath);

  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  _db.exec(SCHEMA_SQL);
  _db.exec(FTS_SCHEMA_SQL);

  logger.info('数据库表结构已就绪');
  return _db;
}

/** 关闭数据库(NFR-04) */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    logger.info('数据库连接已关闭');
  }
}

/**
 * 检测 dbPath 是否已存在市场调研所需表结构(用于 FAQ Q4 场景)
 * @returns true 表示表已存在,插件可直接使用
 */
export function inspectDatabase(config: Config): {
  exists: boolean;
  hasMarketNeeds: boolean;
  hasFts: boolean;
} {
  const dbPath = path.isAbsolute(config.dbPath)
    ? config.dbPath
    : path.resolve(process.cwd(), config.dbPath);

  const exists = fs.existsSync(dbPath);
  if (!exists) return { exists: false, hasMarketNeeds: false, hasFts: false };

  // 用只读探针,避免自动建表
  const probe = new Database(dbPath, { readonly: true });
  try {
    const tables = probe
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((t) => t.name));
    return {
      exists: true,
      hasMarketNeeds: names.has('market_needs'),
      hasFts: names.has('market_needs_fts'),
    };
  } finally {
    probe.close();
  }
}