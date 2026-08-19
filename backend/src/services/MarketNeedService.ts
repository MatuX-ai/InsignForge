/**
 * 需求库服务 - 检索 / 写入市场调研原始数据
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { MarketNeed, MarketNeedSource } from '../types/index.js';

interface MarketNeedRow {
  id: string;
  content: string;
  source: MarketNeedSource;
  url: string | null;
  author: string | null;
  title: string | null;
  category: string | null;
  sentiment_score: number;
  engagement: number;
  tags: string | null;
  project_id: string;
  crawled_at: string;
}

function rowToNeed(row: MarketNeedRow): MarketNeed {
  return {
    ...row,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
  };
}

export const MarketNeedService = {
  /** 批量写入(去重:同 URL 不重复入库) */
  bulkInsert(needs: Omit<MarketNeed, 'id' | 'crawled_at'>[]): number {
    const db = getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO market_needs
       (id, content, source, url, author, title, category, sentiment_score, engagement, tags, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = db.transaction((items: typeof needs) => {
      let count = 0;
      for (const n of items) {
        const result = insert.run(
          randomUUID(),
          n.content,
          n.source,
          n.url,
          n.author,
          n.title,
          n.category,
          n.sentiment_score ?? 0,
          n.engagement ?? 0,
          n.tags ? JSON.stringify(n.tags) : null,
          n.project_id
        );
        if (result.changes > 0) count++;
      }
      return count;
    });

    return tx(needs);
  },

  /** 列出某项目下的所有需求 */
  listByProject(projectId: string, limit = 200): MarketNeed[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM market_needs WHERE project_id = ? ORDER BY engagement DESC, crawled_at DESC LIMIT ?`
      )
      .all(projectId, limit) as MarketNeedRow[];
    return rows.map(rowToNeed);
  },

  /** 关键词全文检索(基于 FTS5) */
  search(keyword: string, limit = 50): MarketNeed[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT m.* FROM market_needs m
         JOIN market_needs_fts f ON m.rowid = f.rowid
         WHERE market_needs_fts MATCH ?
         ORDER BY rank LIMIT ?`
      )
      .all(`${keyword}*`, limit) as MarketNeedRow[];
    return rows.map(rowToNeed);
  },
};