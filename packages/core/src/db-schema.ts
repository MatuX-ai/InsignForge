/**
 * SQLite 建表 SQL(SDK 简化版)
 *
 * 与 backend/src/db/schema.ts 保持兼容(子集):
 * - 仅保留 SDK 消费者需要的 market_needs 表与 FTS5 触发器
 * - users / projects / project_reports / executions 由各 consumer 管理;
 *   SDK 通过 FTS5 全文检索消费 market_needs 即可
 *
 * 复用 FAQ Q4 的"同一份需求库"语义:多个 SDK 消费者可指向同一 SQLite 文件
 * 自动检测并复用。
 */

export const SCHEMA_SQL = `
-- ============================================================
-- 需求库(原始数据:Reddit/HN 帖子、搜索结果)
-- 与 backend/src/db/schema.ts 中 market_needs 表结构一致
-- ============================================================
CREATE TABLE IF NOT EXISTS market_needs (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source VARCHAR(50) NOT NULL,
  url TEXT,
  author VARCHAR(100),
  title TEXT,
  category VARCHAR(50),
  sentiment_score REAL DEFAULT 0,
  engagement INTEGER DEFAULT 0,
  tags TEXT,
  project_id TEXT,
  crawled_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_needs_source ON market_needs(source);
CREATE INDEX IF NOT EXISTS idx_market_needs_crawled ON market_needs(crawled_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_needs_engagement ON market_needs(engagement DESC);
`;

/**
 * FTS5 全文检索虚拟表(用于 search_demand 工具)
 * 必须先建主表再建 FTS5;触发器自动同步
 */
export const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS market_needs_fts USING fts5(
  content,
  title,
  tags,
  content='market_needs',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS market_needs_ai AFTER INSERT ON market_needs BEGIN
  INSERT INTO market_needs_fts(rowid, content, title, tags)
  VALUES (new.rowid, new.content, new.title, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS market_needs_ad AFTER DELETE ON market_needs BEGIN
  INSERT INTO market_needs_fts(market_needs_fts, rowid, content, title, tags)
  VALUES('delete', old.rowid, old.content, old.title, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS market_needs_au AFTER UPDATE ON market_needs BEGIN
  INSERT INTO market_needs_fts(market_needs_fts, rowid, content, title, tags)
  VALUES('delete', old.rowid, old.content, old.title, old.tags);
  INSERT INTO market_needs_fts(rowid, content, title, tags)
  VALUES (new.rowid, new.content, new.title, new.tags);
END;
`;
