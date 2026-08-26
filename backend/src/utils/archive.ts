/**
 * 历史文档自动归档工具
 *
 * 生成的文档(商业计划书 / 开发文档等 ZIP)在内存之外,自动落盘到
 * "历史文档"目录,避免依赖手动下载,重启后文件仍然存在。
 *
 * 目录结构: <HISTORY_DOC_DIR>/<项目名>/<项目名>-<类别>.zip
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

/** 把 ZIP Buffer 归档到历史文档目录,返回保存后的绝对路径 */
export function saveZipToHistoryDoc(opts: {
  projectName: string;
  category: string;
  zip: Buffer;
}): string {
  const safeName = sanitizeFileName(opts.projectName) || '未命名项目';
  const dir = path.join(config.HISTORY_DOC_DIR, safeName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeName}-${opts.category}.zip`);
  fs.writeFileSync(file, opts.zip);
  logger.info({ file, bytes: opts.zip.length }, '文档已自动归档到历史文档');
  return file;
}

/** 移除文件名非法字符,控制长度,避免路径问题 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

export interface HistoryDocEntry {
  /** 项目文件夹绝对路径 */
  dir: string;
  /** 文件夹内的归档文件名列表 */
  files: string[];
}

/**
 * 扫描历史文档目录,返回 项目名 -> { dir, files } 映射
 * 供历史记录页展示"该项目已生成哪些文档"
 */
export function listHistoryDocs(): Record<string, HistoryDocEntry> {
  const root = config.HISTORY_DOC_DIR;
  const result: Record<string, HistoryDocEntry> = {};
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return result; // 目录尚不存在
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name);
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => !f.startsWith('.') && fs.statSync(path.join(dir, f)).isFile());
      if (files.length > 0) {
        result[ent.name] = { dir, files };
      }
    } catch {
      // 忽略单个目录读取失败
    }
  }
  return result;
}
