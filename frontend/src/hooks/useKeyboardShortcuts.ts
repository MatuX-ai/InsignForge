/**
 * v1.8 P7-C: Web 版全局键盘快捷键
 *
 * 设计原则:
 *   - 与桌面原生 Menu 快捷键(N / 1 / 2 / 3 / , / U / F1)互补,不冲突
 *   - 不侵入输入框:当焦点在 input/textarea/contenteditable 时,自动忽略字母/数字键
 *   - 默认 `?` 键唤出快捷键说明 Modal
 *   - 默认 `/` 键触发 onFocusInput 回调(页面级注册"聚焦第一个输入框")
 *   - 提供静态 SHORTCUTS 列表给 UI 渲染说明
 *
 * 注册 API:
 *   useKeyboardShortcuts({
 *     onShowHelp: () => void,
 *     onFocusInput?: () => void,
 *   })
 */
import { useEffect } from 'react';

export interface ShortcutEntry {
  /** 显示给用户看的按键名,支持 / Ctrl/Shift/+ 字母 形式 */
  keys: string;
  /** 中文说明 */
  description: string;
  /** 是否仅在桌面端生效(由原生 Menu 提供) */
  desktopOnly?: boolean;
}

/**
 * 全局快捷键列表(给 ShortcutsHelp Modal 渲染用)。
 * 桌面原生 Menu 提供的标记为 desktopOnly:true,在 Modal 上注明「桌面专享」。
 */
export const SHORTCUTS: ReadonlyArray<ShortcutEntry> = [
  // Web 专属(本 hook 注册)
  { keys: '?', description: '显示 / 隐藏快捷键说明' },
  { keys: '/', description: '聚焦首页想法输入框' },
  { keys: 'Esc', description: '关闭弹窗 / 取消当前操作' },
  // 桌面原生菜单(Menu 触发 → DesktopNavigator 订阅 → 路由跳转)
  { keys: 'Ctrl/Cmd + N', description: '新建调研(回到首页)', desktopOnly: true },
  { keys: 'Ctrl/Cmd + 1', description: '首页', desktopOnly: true },
  { keys: 'Ctrl/Cmd + 2', description: '历史记录', desktopOnly: true },
  { keys: 'Ctrl/Cmd + 3', description: '监控中心', desktopOnly: true },
  { keys: 'Ctrl/Cmd + ,', description: '设置', desktopOnly: true },
  { keys: 'Ctrl/Cmd + U', description: '用户中心', desktopOnly: true },
  { keys: 'F1', description: '打开使用文档', desktopOnly: true },
];

export interface KeyboardShortcutsHandlers {
  /** `?` 键按下时触发(用于打开 / 关闭 ShortcutsHelp Modal) */
  onShowHelp: () => void;
  /** `/` 键按下时触发(用于聚焦首页输入框);不传则忽略 */
  onFocusInput?: () => void;
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutsHandlers): void {
  const { onShowHelp, onFocusInput } = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 在可编辑元素里,字母/数字/退格等都不应该被拦截
      if (isEditableTarget(e.target)) return;

      // 修饰键组合留给浏览器 / 桌面原生 Menu
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;

      if (key === '?' || (e.shiftKey && key === '/')) {
        // 大部分键盘 `?` 是 Shift+/,无需 shift 修饰;但用户在某些浏览器上需要
        e.preventDefault();
        onShowHelp();
        return;
      }

      if (key === '/' && onFocusInput) {
        e.preventDefault();
        onFocusInput();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onShowHelp, onFocusInput]);
}