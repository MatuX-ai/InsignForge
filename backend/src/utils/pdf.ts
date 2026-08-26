/**
 * 系统 Chromium 浏览器探测 + PDF 生成工具
 *
 * 为什么不直接用 puppeteer (捆绑 Chromium):
 *   - puppeteer 全包大约 250MB+;我们的沙盒环境拉镜像慢、易超时
 *   - Windows 22H2 / macOS / Ubuntu 多数都已自带 Edge 或 Chrome,
 *     我们直接调用系统浏览器即可
 *
 * 探测顺序:
 *   1. 环境变量 CHROMIUM_PATH (用户可显式指定)
 *   2. Windows: Microsoft Edge → Google Chrome → Chromium
 *   3. macOS:  Google Chrome → Chromium → Edge for Mac
 *   4. Linux:  google-chrome → chromium-browser → chromium
 *
 * 如果 puppeteer-core 未安装 (import 失败),直接抛 CHROMIUM_NOT_FOUND,
 * 由路由层返回 503,前端降级到 window.print()
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MarketReport, Project } from '../types/index.js';
import { renderReportHtml } from './print-template.js';
import { logger } from '../logger.js';

/** 抛此错误表示未检测到 Chromium,路由层将返回 503 */
export class ChromiumNotFoundError extends Error {
  constructor(message = '未检测到系统中的 Chrome / Edge / Chromium') {
    super(`CHROMIUM_NOT_FOUND: ${message}`);
    this.name = 'ChromiumNotFoundError';
  }
}

interface Candidate {
  path: string;
  source: 'env' | 'win-default' | 'mac-default' | 'linux-default' | 'mac-edge';
}

/** Windows 常见安装路径 */
function windowsCandidates(): string[] {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
  return [
    // Microsoft Edge (Win11 / Win10 22H2 默认)
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    // Google Chrome
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Chromium 直装
    path.join(pfx86, 'Chromium', 'Application', 'chromium.exe'),
    // Brave
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    // Edge Canary/Dev 用户级
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
}

function macCandidates(): string[] {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
}

function linuxCandidates(): string[] {
  // 通过 which / 常见路径
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

function exists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * 探测系统可用的 Chromium 浏览器
 * 找不到任何时返回空数组
 */
export function findSystemChromium(): Candidate[] {
  const found: Candidate[] = [];

  const envPath = process.env['CHROMIUM_PATH'];
  if (envPath && exists(envPath)) {
    found.push({ path: envPath, source: 'env' });
  }

  const platform = process.platform;
  const candidates =
    platform === 'win32'
      ? windowsCandidates()
      : platform === 'darwin'
        ? macCandidates()
        : linuxCandidates();

  for (const c of candidates) {
    if (exists(c)) {
      found.push({
        path: c,
        source:
          platform === 'win32'
            ? 'win-default'
            : platform === 'darwin'
              ? 'mac-default'
              : 'linux-default',
      });
    }
  }

  return found;
}

/**
 * 启动 puppeteer-core 渲染 HTML 为 PDF
 *
 * 行为:
 *   - 找不到 Chromium → 抛 ChromiumNotFoundError
 *   - puppeteer-core 未安装 → 抛 ChromiumNotFoundError(描述安装方法)
 *   - 渲染失败 → 抛包装后的错误
 */
export async function generateReportPdf(
  project: Project,
  report: MarketReport
): Promise<Buffer> {
  const candidates = findSystemChromium();
  if (candidates.length === 0) {
    logger.warn('未检测到 Chromium,PDF 接口将返回 503');
    throw new ChromiumNotFoundError(
      '请安装 Microsoft Edge/Google Chrome/Chromium,或设置环境变量 CHROMIUM_PATH 指向已安装的 Chromium'
    );
  }

  // 动态 import puppeteer-core (可选依赖)
  // puppeteer-core v25+ 是双格式模块;dynamic import 返回的 module 形状:
  //   { default: <namespace>, <named exports> }
  // 这里用 unknown 中转做双层断言,避免 TS 直接报结构不重叠
  let puppeteerNs: typeof import('puppeteer-core');
  try {
    const mod: unknown = await import('puppeteer-core');
    const candidate =
      (mod as { default?: typeof import('puppeteer-core') }).default ??
      (mod as typeof import('puppeteer-core'));
    puppeteerNs = candidate as typeof import('puppeteer-core');
    if (!puppeteerNs || typeof puppeteerNs.launch !== 'function') {
      throw new Error('puppeteer-core 模块结构异常,缺少 launch 方法');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ChromiumNotFoundError(
      `puppeteer-core 未安装或 import 失败: ${msg}。请在 backend/ 下执行 npm i puppeteer-core`
    );
  }

  const html = renderReportHtml(project, report);

  for (const cand of candidates) {
    try {
      logger.info({ path: cand.path, source: cand.source }, '使用 Chromium 渲染 PDF');

      const browser = await puppeteerNs.launch({
        executablePath: cand.path,
        headless: true,
        // 容器/CI 场景需要额外参数
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      try {
        const page = await browser.newPage();
        // puppeteer-core v25 起移除了 'networkidle*',内联 HTML 无外链资源,使用 'load' 即可
        await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
        await page.emulateMediaType('print');
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '14mm',
            bottom: '14mm',
            left: '16mm',
            right: '16mm',
          },
        });
        return Buffer.from(pdf);
      } finally {
        await browser.close().catch(() => undefined);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ path: cand.path, err: msg }, '该 Chromium 启动失败,尝试下一个候选');
      // 继续尝试下一个候选
    }
  }

  throw new ChromiumNotFoundError('所有候选浏览器均启动失败');
}
