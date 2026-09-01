/**
 * 数据库建表 SQL
 * 按 docs/03-技术文档.md §3.8.2 设计
 *
 * 核心 5 张表:
 * - users        (预留,个人版 V1.0 不启用登录)
 * - projects     项目基本信息
 * - market_needs 需求库原始数据(从 Reddit/HN 抓取)
 * - project_reports 项目关联的报告
 * - executions   工作流执行记录
 */
export const SCHEMA_SQL = `
-- ============================================================
-- 用户表(预留,个人版 V1.0 未启用 Casdoor)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
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

CREATE INDEX IF NOT EXISTS idx_users_casdoor_id ON users(casdoor_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- 项目表
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  keywords TEXT,                              -- JSON 数组:提取出的关键词
  status VARCHAR(20) DEFAULT 'draft',         -- draft / analyzing / completed / failed
  progress VARCHAR(200) DEFAULT '',            -- 当前步骤文字描述,前端轮询展示
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- ============================================================
-- 需求库(原始数据:Reddit/HN 帖子、搜索结果)
-- ============================================================
CREATE TABLE IF NOT EXISTS market_needs (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source VARCHAR(50) NOT NULL,                -- reddit / hackernews / google / bing
  url TEXT,
  author VARCHAR(100),
  title TEXT,
  category VARCHAR(50),
  sentiment_score REAL DEFAULT 0,
  engagement INTEGER DEFAULT 0,               -- 点赞/评论数
  tags TEXT,                                  -- JSON 数组
  project_id TEXT,                           -- 关联到调研项目
  crawled_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_market_needs_project ON market_needs(project_id);
CREATE INDEX IF NOT EXISTS idx_market_needs_source ON market_needs(source);
CREATE INDEX IF NOT EXISTS idx_market_needs_crawled ON market_needs(crawled_at DESC);

-- ============================================================
-- 报告表(项目关联的最终报告 JSON)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  report_data TEXT NOT NULL,                  -- 完整 JSON
  generated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reports_project ON project_reports(project_id);

-- ============================================================
-- 执行记录表(调研过程的中间日志)
-- ============================================================
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workflow_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'running',       -- running / success / failed
  current_step VARCHAR(100) DEFAULT '',
  logs TEXT DEFAULT '[]',                     -- JSON 数组
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_executions_project ON executions(project_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);

-- ============================================================
-- 讨论梳理画布表(头脑风暴/商业模式/项目要点梳理)
-- canvas:  画布 JSON { groups: [{ id, title, points: [...] }] }
-- messages: 对话历史 JSON [{ role, content, created_at }]
-- ============================================================
CREATE TABLE IF NOT EXISTS discussion_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,                            -- 关联项目(报告页"进一步探讨"等场景),可为空
  title TEXT NOT NULL,
  mode VARCHAR(20) DEFAULT 'free',            -- business_model / project / free
  canvas TEXT NOT NULL DEFAULT '{"groups":[]}',
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_discussions_created_at ON discussion_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discussions_project ON discussion_sessions(project_id);

-- ============================================================
-- v2.0: 用户配额表(按 user_id 跟踪日调用量,LLM 关键路由计费)
-- 设计:
--   - plan_type 复制自 users.plan_type(冗余便于独立重构)
--   - daily_calls / last_reset_date 用于前端显示今日剩余额度
--   - process_invocations 为进程内窗口补充(未来可接 Redis)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_quotas (
  user_id TEXT PRIMARY KEY,
  plan_type VARCHAR(20) NOT NULL DEFAULT 'free',
  daily_calls INTEGER NOT NULL DEFAULT 0,
  last_reset_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

/**
 * LLM 调用结果缓存表(v1.5 持久化)
 *
 * 设计:
 *   - cache_key 为 SHA256(schemaName + system + user + 关键 options),唯一索引
 *   - schema_name 单独存一列,便于按调用点统计命中率
 *   - expires_at 支持 TTL,过期后 getCached 返回 null 并由 clearExpired 清理
 *   - 不缓存 chatWithTools 的多轮对话,只缓存单轮 JSON 输出
 */
export const LLM_CACHE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key TEXT PRIMARY KEY,
  schema_name TEXT NOT NULL,
  output_json TEXT NOT NULL,
  input_size INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_cache_schema ON llm_cache(schema_name);
CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_cache(expires_at);
`;

/**
 * FTS5 全文检索虚拟表(用于关键词检索历史需求)
 * SQLite 原生支持,无需额外扩展
 */
export const FTS_SCHEMA_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS market_needs_fts USING fts5(
  content,
  title,
  tags,
  content='market_needs',
  content_rowid='rowid'
);

-- 同步触发器
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