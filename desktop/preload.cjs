/**
 * InsightForge 桌面版 - Preload 脚本
 * 通过 contextBridge 向渲染进程暴露最小化能力(版本/平台/打开文件)
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('insightforge', {
  appVersion: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
  isDesktop: true,
  /** 用系统默认程序打开指定路径文件(历史文档快捷打开用) */
  openPath: (p) => ipcRenderer.invoke('open-path', p),
});
