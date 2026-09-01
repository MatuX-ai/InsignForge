/**
 * v2.0: 用户服务 — 在 Casdoor OIDC 回调成功后 upsert users 表。
 *
 * 双轨制:
 *   - 老库中可能存在 email 重复的多条记录(无 casdoor_id);这里按 casdoor_id 优先,
 *     找不到再按 email,找到则补 casdoor_id 并更新头像/name。
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/index.js';
import { logger } from '../../logger.js';

export interface UserRecord {
  id: string;
  casdoor_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  plan_type: string;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  id: string;
  casdoor_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  plan_type: string;
  settings: string | null;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    casdoor_id: row.casdoor_id,
    email: row.email,
    name: row.name ?? '',
    avatar_url: row.avatar_url,
    plan_type: row.plan_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * 按 casdoor_id 查找用户(用于 callback 后无需新建时)
 */
export function findByCasdoorId(casdoorId: string): UserRecord | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM users WHERE casdoor_id = ?`)
    .get(casdoorId) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * 按 id 查找用户(中间件 session.userId 命中时用)
 */
export function findById(id: string): UserRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
    | UserRow
    | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * upsert:按 casdoor_id 命中则更新;否则按 email 命中则补 casdoor_id;
 * 都没有则新建。返回最新记录。
 */
export function findOrCreateByCasdoor(input: {
  casdoorId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}): UserRecord {
  const db = getDb();

  // 1. casdoor_id 命中 → 更新 email/name/avatar
  const byCasdoor = db
    .prepare(`SELECT * FROM users WHERE casdoor_id = ?`)
    .get(input.casdoorId) as UserRow | undefined;
  if (byCasdoor) {
    db.prepare(
      `UPDATE users SET email=?, name=?, avatar_url=?, updated_at=datetime('now') WHERE id=?`
    ).run(input.email, input.name, input.avatarUrl, byCasdoor.id);
    const refreshed = db
      .prepare(`SELECT * FROM users WHERE id=?`)
      .get(byCasdoor.id) as UserRow;
    return rowToUser(refreshed);
  }

  // 2. email 命中 → 关联 casdoor_id(可能是老本地用户首次接入 OIDC)
  const byEmail = db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .get(input.email) as UserRow | undefined;
  if (byEmail) {
    db.prepare(
      `UPDATE users SET casdoor_id=?, name=?, avatar_url=?, updated_at=datetime('now') WHERE id=?`
    ).run(input.casdoorId, input.name, input.avatarUrl, byEmail.id);
    logger.info({ userId: byEmail.id, email: input.email }, '已为本地用户绑定 Casdoor 账号');
    const refreshed = db
      .prepare(`SELECT * FROM users WHERE id=?`)
      .get(byEmail.id) as UserRow;
    return rowToUser(refreshed);
  }

  // 3. 全新用户 → 插入
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, casdoor_id, email, name, avatar_url, plan_type) VALUES (?, ?, ?, ?, ?, 'free')`
  ).run(id, input.casdoorId, input.email, input.name, input.avatarUrl);

  // 同步初始化 user_quotas(free 计划)
  db.prepare(
    `INSERT OR IGNORE INTO user_quotas (user_id, plan_type) VALUES (?, 'free')`
  ).run(id);

  const created = db.prepare(`SELECT * FROM users WHERE id=?`).get(id) as UserRow;
  logger.info({ userId: id, email: input.email }, '新用户已创建');
  return rowToUser(created);
}