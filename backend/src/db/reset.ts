/**
 * 重置数据库(开发脚本)
 * 运行: npm run db:reset
 */
import fs from 'node:fs';
import { config } from '../config.js';
import { closeDb, getDb } from './index.js';
import { logger } from '../logger.js';

const dbPath = config.DATABASE_PATH;

if (fs.existsSync(dbPath)) {
  closeDb();
  fs.unlinkSync(dbPath);
  logger.warn({ dbPath }, '已删除旧数据库文件');
}

const walPath = `${dbPath}-wal`;
const shmPath = `${dbPath}-shm`;
for (const p of [walPath, shmPath]) {
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    logger.warn({ p }, '已删除 WAL/SHM 文件');
  }
}

getDb(); // 触发建表
closeDb();
logger.info('数据库重置完成');