/**
 * 桌面端 API 集中消费入口 (v1.8 P0-A3)
 *
 * 与全局 `window.insightforge` 的关系:
 *   - preload.cjs 在 Electron 主进程通过 contextBridge 注入到 window.insightforge
 *   - web 端 window.insightforge 为 undefined
 *   - 本 hook 返回的 api 在两种环境下都安全可调用:
 *     · 桌面端: 真接 IPC
 *     · web 端: 返回 no-op stub,所有方法返回 ok:false / message 提醒
 *
 * 优势:
 *   - 取代散落 `window.insightforge?.openPath ? ... : '仅桌面端可用'`
 *   - 提供强类型(直接从 types/index.ts 的 Window.insightforge 推导)
 *   - 配合 <DesktopOnly> 组件,让 web 端 UI 自动隐藏桌面专属按钮,
 *     避免"点了按钮后弹个错误提示"的负面体验
 */
import { useMemo } from 'react';
import type {} from '../types';

export interface DesktopApi {
  /** 当前是否运行在桌面端(Electron) */
  readonly isDesktop: boolean;
  /** 平台标识: 'win32' | 'darwin' | 'linux' | 其他 */
  readonly platform: string;
  /** 应用版本号 */
  readonly appVersion: string;
  /** 用系统默认程序打开指定路径文件 */
  readonly openPath: (p: string) => Promise<{ ok: boolean; message?: string }>;
  /** 弹原生目录选择对话框,把 sourceDir 整个目录复制到用户选定位置 */
  readonly saveDir: (args: {
    sourceDir: string;
    defaultName?: string;
  }) => Promise<{
    ok: boolean;
    canceled?: boolean;
    targetDir?: string;
    message?: string;
  }>;
  /** v1.8 P0-A1: 主动调用通知主进程跳转路由 */
  readonly navigate: (path: string) => Promise<{ ok: boolean; message?: string }>;
  /** v1.8 P0-A1: 订阅主进程 Menu 路由跳转;返回取消订阅函数 */
  readonly onNavigate: (cb: (path: string) => void) => () => void;
  /** v1.8 P0-A2: 弹系统级通知 */
  readonly notify: (args: { title: string; body?: string; silent?: boolean }) => Promise<{ ok: boolean; message?: string }>;
  /** v1.8 P0-A6: 复制文本到剪贴板 */
  readonly copy: (text: string) => Promise<{ ok: boolean; message?: string }>;
}

const WEB_STUB: DesktopApi = {
  isDesktop: false,
  platform: 'web',
  appVersion: 'web',
  openPath: async () => ({ ok: false, message: '仅桌面端可用' }),
  saveDir: async () => ({ ok: false, message: '仅桌面端可用' }),
  navigate: async () => ({ ok: false, message: '仅桌面端可用' }),
  onNavigate: () => () => undefined,
  notify: async () => ({ ok: false, message: '仅桌面端可用' }),
  copy: async () => ({ ok: false, message: '仅桌面端可用' }),
};

/**
 * 取得当前环境的桌面端 API。
 * web 端返回安全的 no-op stub(不会 throw),UI 层据此展示。
 */
export function useDesktopApi(): DesktopApi {
  return useMemo<DesktopApi>(() => {
    if (typeof window === 'undefined') return WEB_STUB;
    const api = window.insightforge;
    if (!api) return WEB_STUB;
    return api as DesktopApi;
  }, []);
}
