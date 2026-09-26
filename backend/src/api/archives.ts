/**
 * 历史文档归档路由 - /api/v1/archives
 *
 * GET  /                       返回历史文档目录结构: { 项目名: { dir, files } }
 *                              供历史记录页展示"该项目已生成哪些文档"(PDF 图标 / 胶囊入口)
 * GET  /:projectKey/download   WARN-04 修复: 把某个项目的所有归档打包为 zip 流下载,
 *                              让 Web 用户也能"一键带走全部历史文档",不必依赖桌面端的 openPath
 *
 * 安全提示:
 *   - projectKey 仅为归档目录名(已经后端 sanitize 过),不会出现 ../ 跳出风险
 *   - 但仍校验项目目录必须在 config.HISTORY_DOC_DIR 之下,避免符号链接逃逸
 */
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { asyncHandler, ok } from './response.js';
import { listHistoryDocs } from '../utils/archive.js';
import { createZipBuffer } from '../utils/zip.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const archivesRouter = Router();

archivesRouter.get(
  '/',
  asyncHandler((_req, res) => {
    return ok(res, listHistoryDocs());
  })
);

/**
 * 打包下载某个项目的所有归档文件。
 * URL: GET /api/v1/archives/:projectKey/download
 *   projectKey 是 sanitize 后的目录名(出现在 listHistoryDocs() 的 key 中)
 *
 * 实现:
 *   1. 校验 projectKey 不含 / \\ ..
 *   2. 限定项目目录在 config.HISTORY_DOC_DIR 之下(resolve 后用 startsWith 防御)
 *   3. 递归扫描该目录下所有文件,编码到 zip 后流回
 *   4. 设置 Content-Disposition: attachment; filename*=UTF-8''<encoded>
 */
archivesRouter.get(
  '/:projectKey/download',
  asyncHandler((req, res) => {
    const rawKey = req.params.projectKey ?? '';
    // 防御 1:不允许路径穿越或符号逃逸
    if (
      rawKey.includes('..') ||
      rawKey.includes('/') ||
      rawKey.includes('\\') ||
      rawKey.length === 0 ||
      rawKey.length > 80
    ) {
      res.status(400).json({ ok: false, message: '非法项目标识' });
      return;
    }
    const projectDir = path.resolve(config.HISTORY_DOC_DIR, rawKey);
    const rootResolved = path.resolve(config.HISTORY_DOC_DIR);
    if (
      projectDir !== rootResolved &&
      !projectDir.startsWith(rootResolved + path.sep)
    ) {
      res.status(403).json({ ok: false, message: '禁止访问历史文档之外的位置' });
      return;
    }
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      res.status(404).json({ ok: false, message: '未找到该项目归档' });
      return;
    }

    // 递归把所有文件读入内存(归档通常 < 几 MB, STORE 模式下非常快)
    interface Walk {
      zipPath: string; // zip 内的相对路径
      content: string;
    }
    const walks: Walk[] = [];

    /** 递归收集普通文件; .DS_Store / Thumbs.db 等系统文件跳过 */
    const collect = (absDir: string, relDir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
      } catch (err) {
        logger.warn({ absDir, err }, '读取归档子目录失败,跳过');
        return;
      }
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue;
        const childAbs = path.join(absDir, ent.name);
        const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;
        try {
          if (ent.isFile()) {
            const content = fs.readFileSync(childAbs, 'utf8');
            walks.push({ zipPath: childRel, content });
          } else if (ent.isDirectory()) {
            collect(childAbs, childRel);
          }
        } catch (err) {
          logger.warn({ childAbs, err }, '收集归档文件失败,跳过');
        }
      }
    };
    collect(projectDir, '');

    if (walks.length === 0) {
      res.status(404).json({ ok: false, message: '该项目归档为空' });
      return;
    }

    const zip = createZipBuffer(
      walks.map((w) => ({ path: w.zipPath, content: w.content })),
      new Date()
    );

    // 文件名 UTF-8 编码
    const encName = encodeURIComponent(`${rawKey}-归档.zip`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${rawKey}-archives.zip"; filename*=UTF-8''${encName}`
    );
    res.setHeader('Content-Length', String(zip.length));
    res.send(zip);
  })
);
