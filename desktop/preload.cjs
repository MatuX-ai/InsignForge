/**
 * InsightForge 桌面版 - Preload 脚本
 * 通过 contextBridge 向渲染进程暴露最小化能力
 *
 * v1.8 P0-A1/A2/A6 扩展:
 *   - navigate  + onNavigate : 原生 Menu 快捷键跳转路由
 *   - notify    : 系统级 Notification(调研完成)
 *   - copy      : 复制到剪贴板(错误诊断导出)
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
  /** v1.8 P0-A1: 前端主动调用通知主进程跳转路由(供前端代码使用) */
  navigate: (path) => ipcRenderer.invoke('desktop:navigate', path),
  /** v1.8 P0-A1: 订阅主进程 Menu 触发的路由跳转;返回取消订阅函数 */
  onNavigate: (cb) => {
    const listener = (_event, path) => cb(path);
    ipcRenderer.on('desktop:navigate', listener);
    return () => ipcRenderer.off('desktop:navigate', listener);
  },
  /** v1.8 P0-A2: 弹系统级通知(调研完成/失败/历史归档完成) */
  notify: (args) => ipcRenderer.invoke('desktop:notify', args),
  /** v1.8 P0-A6: 复制文本到剪贴板(错误诊断导出) */
  copy: (text) => ipcRenderer.invoke('desktop:copy', text),
});