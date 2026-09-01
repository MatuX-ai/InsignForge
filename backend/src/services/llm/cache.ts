/**
 * v1.5 持久化 - LLM 调用结果缓存
 *
 * 目的:
 *   对确定的 LLM JSON 调用(同 schemaName + 同 system/user + 同 temperature/maxTokens),
 *   落盘 SQLite,二次相同输入直接读盘,避免重复调用与 API 费用。
 *
 * 设计取舍:
 *   - 缓存的是 LLM **原始 content**(JSON 字符串),不是 zod 校验后的对象。
 *     这样 schema 升级时旧缓存仍可被新 schema 校验,避免缓存值与代码漂移。
 *   - cache_key 用 SHA256 哈希,不可读但稳定;schema_name 单独存便于按维度统计。
 *   - TTL 通过 expires_at 列实现;过期记录 getCached 返回 null,
 *     可由 clearExpired() 主动清理或在下一次 getCached 时按需清理。
 *   - 失败静默:DB 写失败时仅日志告警,不破坏 LLM 调用主流程。
 *
 * 与现有架构的衔接:
 *   - chatJson 接收 cacheMeta 参数,在调用 chatComplete 前后做查 / 写
 *   - 5 个调用点(extractKeywords / generateReport / 三个 v1.4 智能化)显式传 cacheMeta,
 *     其他路径(如 chatWithTools / chatJson 在讨论中)不传 → 不缓存
 */
import { createHash } from 'node:crypto';
import { getDb } from '../../db/index.js';
import { logger } from '../../logger.js';

/** 全局缓存开关: 关闭时所有 cache 操作都是 no-op,DB 不读不写 */
export function isCacheEnabled(): boolean {
  const raw = process.env.INSIGHTFORGE_LLM_CACHE_ENABLED;
  if (raw == null) return true; // 默认开启
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** 全局默认 TTL(天) */
export function getDefaultTtlDays(): number {
  const raw = process.env.INSIGHTFORGE_LLM_CACHE_TTL_DAYS;
  if (raw == null) return 7;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 7;
  return n;
}

/** 缓存的元信息(调用方传入) */
export interface CacheMeta {
  schemaName: string;
  /** TTL 天数;不传则用全局默认 */
  ttlDays?: number;
}

/**
 * 构造缓存键: SHA256(schemaName + system + user + 关键 options)
 * 关键 options 包含 temperature / maxTokens(影响输出);
 * 不包含 jsonMode(单轮 JSON 调用统一开启,不影响 key 区分)。
 */
export function makeCacheKey(
  schemaName: string,
  system: string,
  user: string,
  options: { temperature?: number; maxTokens?: number }
): string {
  const parts = [
    schemaName,
    system,
    user,
    `t=${options.temperature ?? 0.4}`,
    `m=${options.maxTokens ?? 4096}`,
  ];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

interface CachedRow {
  output_json: string;
  expires_at: string | null;
}

/**
 * 读取缓存:命中且未过期返回 LLM 原始 content;未命中或过期返回 null
 * 同时原子累加 hit_count(便于后续按"价值"清理)
 */
export function getCachedOutput(cacheKey: string): string | null {
  if (!isCacheEnabled()) return null;

  let row: CachedRow | undefined;
  try {
    const db = getDb();
    row = db
      .prepare('SELECT output_json, expires_at FROM llm_cache WHERE cache_key = ?')
      .get(cacheKey) as CachedRow | undefined;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), cacheKey },
      'LLM 缓存读取失败,按未命中处理'
    );
    return null;
  }

  if (!row) return null;

  // TTL 校验
  if (row.expires_at) {
    const expiresAt = Date.parse(row.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      return null; // 已过期
    }
  }

  // 累加命中计数(异步失败不影响返回)
  try {
    const db = getDb();
    db.prepare('UPDATE llm_cache SET hit_count = hit_count + 1 WHERE cache_key = ?').run(
      cacheKey
    );
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'LLM 缓存命中计数更新失败'
    );
  }

  return row.output_json;
}

interface WriteOptions {
  /** 自定义 TTL 天数;不传则用全局默认 */
  ttlDays?: number;
  /** 输入字节数,便于后续排错 / 体积分析 */
  inputSize?: number;
}

/**
 * 写入缓存: 若已存在则忽略(并发场景幂等)
 * 失败静默,主流程不应感知缓存写失败
 */
export function setCachedOutput(
  cacheKey: string,
  schemaName: string,
  outputJson: string,
  opts: WriteOptions = {}
): void {
  if (!isCacheEnabled()) return;
  if (!schemaName.trim() || !cacheKey.trim() || !outputJson) return;

  const ttlDays = opts.ttlDays ?? getDefaultTtlDays();
  // 用 ISO 字符串,SQLite 按文本比较;Date.now() + n*86400_000
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();

  try {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO llm_cache
        (cache_key, schema_name, output_json, input_size, expires_at)
        VALUES (?, ?, ?, ?, ?)`
    ).run(cacheKey, schemaName, outputJson, opts.inputSize ?? 0, expiresAt);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), schemaName, cacheKey },
      'LLM 缓存写入失败,不影响主流程'
    );
  }
}

/**
 * 主动清理过期记录(可用于后台任务 / 手动触发)
 * @returns 删除的记录数
 */
export function clearExpired(): number {
  if (!isCacheEnabled()) return 0;
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const info = db.prepare('DELETE FROM llm_cache WHERE expires_at IS NOT NULL AND expires_at < ?').run(now);
    return info.changes;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'LLM 缓存清理失败'
    );
    return 0;
  }
}

/**
 * 缓存统计(供 metrics / 健康检查使用)
 */
export interface CacheStats {
  total: number;
  active: number; // 未过期
  expired: number;
  bySchema: Array<{ schema: string; count: number; totalHits: number }>;
}

export function getCacheStats(): CacheStats {
  const empty: CacheStats = { total: 0, active: 0, expired: 0, bySchema: [] };
  if (!isCacheEnabled()) return empty;
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const total = (
      db.prepare('SELECT COUNT(*) as c FROM llm_cache').get() as { c: number }
    ).c;
    const active = (
      db
        .prepare(
          'SELECT COUNT(*) as c FROM llm_cache WHERE expires_at IS NULL OR expires_at >= ?'
        )
        .get(now) as { c: number }
    ).c;
    const bySchema = db
      .prepare(
        `SELECT schema_name as schema, COUNT(*) as count, COALESCE(SUM(hit_count), 0) as totalHits
         FROM llm_cache
         GROUP BY schema_name
         ORDER BY count DESC`
      )
      .all() as Array<{ schema: string; count: number; totalHits: number }>;
    return {
      total,
      active,
      expired: total - active,
      bySchema,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'LLM 缓存统计失败'
    );
    return empty;
  }
}
