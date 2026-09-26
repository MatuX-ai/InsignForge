/**
 * PDF 导出偏好 - 纸张大小与方向 (v1.8 P1-D)
 *
 * 之前:
 *   - index.css 写死 `@page { size: A4 }`,海外用户打印 A4 报告内容溢出或排版变形,
 *     Letter (美/加) 用户也只能强制 A4,无法切换。
 *
 * 之后:
 *   - 用户在 Report 页纸张选择器里切换 PaperSize × Orientation,
 *   - 切换即时写入 localStorage + 动态注入 `@page` 规则,
 *   - 后端 PDF (Chromium) 与浏览器打印两条路径都自动套用当前偏好。
 *
 * 与原有 index.css 中 `@page { size: A4; margin: 14mm 16mm }` 的关系:
 *   - 静态规则作为"无偏好"时的兜底(打印按钮走 window.print()),
 *   - 运行时通过本模块动态注入的 `<style id="insightforge-pdf-page">` 覆盖默认尺寸,
 *     与浏览器 CSS 同 ID 优先级 (后者插入到 head 末尾)。
 */

export type PaperSize = 'A4' | 'A3' | 'Letter' | 'Legal' | 'A5';
export type Orientation = 'portrait' | 'landscape';

export interface PdfPreferences {
  paperSize: PaperSize;
  orientation: Orientation;
}

export const PAPER_SIZES: ReadonlyArray<{ value: PaperSize; label: string; desc: string }> = [
  { value: 'A4', label: 'A4', desc: '210×297mm · 国际通用' },
  { value: 'A3', label: 'A3', desc: '297×420mm · 大幅面' },
  { value: 'A5', label: 'A5', desc: '148×210mm · 紧凑便携' },
  { value: 'Letter', label: 'Letter', desc: '216×279mm · 美/加' },
  { value: 'Legal', label: 'Legal', desc: '216×356mm · 美法律' },
];

export const ORIENTATIONS: ReadonlyArray<{ value: Orientation; label: string; emoji: string }> = [
  { value: 'portrait', label: '纵向', emoji: '📄' },
  { value: 'landscape', label: '横向', emoji: '📃' },
];

export const DEFAULT_PDF_PREFS: PdfPreferences = {
  paperSize: 'A4',
  orientation: 'portrait',
};

const STORAGE_KEY = 'insightforge.pdfPrefs.v1';

const isPaperSize = (v: unknown): v is PaperSize =>
  v === 'A4' || v === 'A3' || v === 'A5' || v === 'Letter' || v === 'Legal';

const isOrientation = (v: unknown): v is Orientation =>
  v === 'portrait' || v === 'landscape';

/** 从 localStorage 读取偏好,容错降级到默认。SSR 安全(try/catch localStorage) */
export function loadPdfPreferences(): PdfPreferences {
  if (typeof window === 'undefined') return DEFAULT_PDF_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PDF_PREFS;
    const parsed = JSON.parse(raw) as Partial<PdfPreferences>;
    return {
      paperSize: isPaperSize(parsed.paperSize) ? parsed.paperSize : DEFAULT_PDF_PREFS.paperSize,
      orientation: isOrientation(parsed.orientation)
        ? parsed.orientation
        : DEFAULT_PDF_PREFS.orientation,
    };
  } catch {
    return DEFAULT_PDF_PREFS;
  }
}

/** 写入 localStorage,失败时静默(隐私模式 / 容量满) */
export function savePdfPreferences(prefs: PdfPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式或配额满,静默降级 - 不影响导出主流程
  }
}

/**
 * 动态注入 @page 规则,覆盖 index.css 中硬编码的 A4 默认值。
 * 同一 style 元素复用,避免反复插入 DOM。
 *
 * 注意: 必须在 window.print() / 后端 PDF 生成前调用,否则浏览器已锁定纸张。
 */
export function applyPaperSize(prefs: PdfPreferences): void {
  if (typeof document === 'undefined') return;
  const orient = prefs.orientation === 'landscape' ? ' landscape' : '';
  // 边距按纸张大小自动调节:大纸张给多一点空间,小纸张(A5)收窄
  const marginBySize: Record<PaperSize, string> = {
    A4: '14mm 16mm',
    A3: '18mm 20mm',
    A5: '10mm 12mm',
    Letter: '14mm 16mm',
    Legal: '14mm 18mm',
  };
  const margin = marginBySize[prefs.paperSize];
  const css = `@page { size: ${prefs.paperSize}${orient}; margin: ${margin}; }`;

  let styleEl = document.getElementById('insightforge-pdf-page') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'insightforge-pdf-page';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

/** 工具方法:获取 @page 当前生效的纸张(用于预览/调试) */
export function getEffectivePaperSize(): string {
  if (typeof document === 'undefined') return DEFAULT_PDF_PREFS.paperSize;
  const el = document.getElementById('insightforge-pdf-page');
  if (!el?.textContent) return DEFAULT_PDF_PREFS.paperSize;
  const m = /size:\s*([A-Za-z0-9]+)/.exec(el.textContent);
  return m ? m[1] : DEFAULT_PDF_PREFS.paperSize;
}
