/**
 * InsightForge 桌面版 - Preload 脚本
 * 通过 contextBridge 向渲染进程暴露最小化能力(版本/平台/打开文件/另存目录)
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('insightforge', {
  appVersion: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
  isDesktop: true,
  /** 用系统默认程序打开指定路径文件(历史文档快捷打开用) */
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  /**
   * 弹原生目录选择对话框,把 sourceDir 整个目录复制到用户选定位置。
   * 用于商业计划书"另存为目录"。仅桌面端可用。
   */
  saveDir: (args) => ipcRenderer.invoke('save-dir', args),
});