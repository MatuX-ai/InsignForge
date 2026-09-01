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

/**
 * 把多份 md 文本按"项目目录/项目-类别/文件名.md"的结构落到历史文档目录。
 * 适用于希望以独立文件形式落地、而非打包成 ZIP 的场景(如商业计划书)。
 *
 * 行为:
 *   - 自动创建子目录 `<HISTORY_DOC_DIR>/<项目>/<项目>-<类别>/`
 *   - 每份 entry 写入 `<filename>.md` 同名文件,冲突则覆盖
 *   - 写入顺序遵循 entries 数组顺序,保证可预测
 *
 * 返回值:
 *   - dir: 已创建的归档目录绝对路径
 *   - filenames: 已写入的文件名(顺序与 entries 一致)
 */
export function saveMdsToHistoryDoc(opts: {
  projectName: string;
  category: string;
  entries: Array<{ filename: string; content: string }>;
}): { dir: string; filenames: string[] } {
  const safeName = sanitizeFileName(opts.projectName) || '未命名项目';
  const dir = path.join(config.HISTORY_DOC_DIR, safeName, `${safeName}-${opts.category}`);
  fs.mkdirSync(dir, { recursive: true });
  const filenames: string[] = [];
  for (const entry of opts.entries) {
    // 防御性校验:避免路径穿越
    if (!entry.filename || entry.filename.includes('..') || entry.filename.includes('/') || entry.filename.includes('\\')) {
      throw new Error(`archive: 文件名非法(${entry.filename})`);
    }
    const file = path.join(dir, entry.filename);
    fs.writeFileSync(file, entry.content, 'utf8');
    filenames.push(entry.filename);
  }
  logger.info({ dir, count: filenames.length }, 'md 文档已自动归档到历史文档');
  return { dir, filenames };
}

/** 移除文件名非法字符,控制长度,避免路径问题 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

export interface HistoryDocEntry {
  /** 项目文件夹绝对路径 */
  dir: string;
  /**
   * 归档条目相对路径列表(相对于 dir)。
   *   - 顶层 .zip 等文件以文件名直接列出
   *   - 子目录(如商业计划书)里的 md 以 "<子目录名>/<文件名>.md" 形式列出
   * 供历史记录页 / 报告页左侧"已生成文档"列表点击打开用。
   */
  files: string[];
}

/**
 * 扫描历史文档目录,返回 项目名 -> { dir, files } 映射
 * 供历史记录页展示"该项目已生成哪些文档"
 *
 * 扫描规则:
 *   - 顶层 *.zip / *.pdf 直接列在 files
 *   - 项目子目录(如商业计划书归档目录)递归扫描,
 *     其中的 .md / .txt 等文本文件以 "<子目录名>/<文件名>" 的相对路径形式列出,
 *     便于前端拼接 `${dir}\\${file}` 一次性拿到完整可打开路径
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
    const files: string[] = [];
    let childEntries: fs.Dirent[];
    try {
      childEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of childEntries) {
      if (child.name.startsWith('.')) continue;
      const childFull = path.join(dir, child.name);
      try {
        if (child.isFile()) {
          files.push(child.name);
        } else if (child.isDirectory()) {
          // 递归扫描子目录(如商业计划书归档目录)中的文本文件
          let grandChildren: fs.Dirent[];
          try {
            grandChildren = fs.readdirSync(childFull, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const g of grandChildren) {
            if (g.name.startsWith('.')) continue;
            try {
              if (g.isFile()) {
                files.push(`${child.name}/${g.name}`);
              }
            } catch {
              // 忽略 stat 失败的项
            }
          }
        }
      } catch {
        // 忽略 stat 失败的项
      }
    }
    if (files.length > 0) {
      result[ent.name] = { dir, files };
    }
  }
  return result;
}
