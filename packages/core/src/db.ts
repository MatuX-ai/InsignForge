/**
 * SQLite 数据库封装(基于 better-sqlite3)
 *
 * 设计:
 * 1. 单例,首次 getDb() 时自动建表
 * 2. WAL + foreign_keys + synchronous=NORMAL,与 backend 保持一致
 * 3. closeDb() 由 InsightForgeCore.dispose() 调用(NFR-04)
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config-types.js';
import { logger } from './logger.js';
import { SCHEMA_SQL, FTS_SCHEMA_SQL } from './db-schema.js';

let _db: Database.Database | null = null;

/**
 * 获取数据库实例(单例)
 * 首次调用时确保目录存在并执行建表
 */
export function getDb(config: Config): Database.Database {
  if (_db) return _db;

  const dbPath = normalizeDbPath(config.dbPath);
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

/**
 * 解析 dbPath 为绝对路径,但保留 `:memory:` 等内存数据库 URI 原样。
 * Windows 下 `path.resolve(cwd, ':memory:')` 会得到含冒号的非法文件名,
 * 因此内存路径必须直接透传给 better-sqlite3。
 */
function normalizeDbPath(dbPath: string): string {
  if (dbPath === ':memory:' || dbPath.startsWith('file:')) return dbPath;
  return path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
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
 * 检测 better-sqlite3 原生绑定是否可用
 *
 * 不仅检测包是否安装,还真正尝试连接一次 `:memory:` 数据库。
 * 在某些环境(如无 Python 构建工具链的开发机)下,build 可能失败,
 * 运行时 import 不会立刻抛错,直到调用 Database() 才抛 binding 错误。
 *
 * 返回 false 时,SDK 会跳过所有数据库相关路径(LRU 缓存仍可用)。
 */
export function hasSqliteBindings(): boolean {
  try {
    // 直接用模块顶部 import 的 Database 探测绑定(ESM 下没有全局 require,
    // 之前用 require 会导致 ESM 运行时永远判定绑定不可用)
    const probe = new Database(':memory:');
    probe.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测 dbPath 是否已存在市场调研所需表结构
 * @returns true 表示表已存在,可直接使用
 */
export function inspectDatabase(config: Config): {
  exists: boolean;
  hasMarketNeeds: boolean;
  hasFts: boolean;
} {
  const dbPath = normalizeDbPath(config.dbPath);

  const exists = fs.existsSync(dbPath);
  if (!exists) return { exists: false, hasMarketNeeds: false, hasFts: false };

  if (!hasSqliteBindings()) {
    logger.warn({ dbPath }, 'better-sqlite3 原生绑定不可用,跳过 inspect');
    return { exists: true, hasMarketNeeds: false, hasFts: false };
  }

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
