/**
 * v1.8 P7-C: 全局快捷键说明 Modal
 *
 * - 复用 Modal 通用组件(自带 Esc 关闭 + focus trap)
 * - 顶部 kbd 风格的按键标签 + 下方说明
 * - 区分"Web 通用"和"桌面专享"两组
 * - 通过 useKeyboardShortcuts(`?` 键) 全局唤起
 */
import { Modal } from './Modal';
import { SHORTCUTS } from '../hooks/useKeyboardShortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsHelp({ open, onClose }: Props) {
  const web = SHORTCUTS.filter((s) => !s.desktopOnly);
  const desktop = SHORTCUTS.filter((s) => s.desktopOnly);

  return (
    <Modal
      open={open}
      title="⌨️ 键盘快捷键"
      size="sm"
      onClose={onClose}
      primaryLabel="知道了"
    >
      <div className="space-y-4">
        <section>
          <h3 className="text-helper font-medium text-text-secondary mb-2 uppercase tracking-wide">
            Web 通用
          </h3>
          <ul className="space-y-2">
            {web.map((s) => (
              <li
                key={s.keys}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-b-0"
              >
                <span className="text-body text-text-primary">{s.description}</span>
                <kbd className="inline-flex items-center px-2 py-0.5 text-helper rounded border border-border bg-bg/60 text-text-secondary font-mono whitespace-nowrap">
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-helper font-medium text-text-secondary mb-2 uppercase tracking-wide">
            桌面专享 <span className="text-text-tertiary">(由原生菜单提供)</span>
          </h3>
          <ul className="space-y-2">
            {desktop.map((s) => (
              <li
                key={s.keys}
                className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-b-0"
              >
                <span className="text-body text-text-primary">{s.description}</span>
                <kbd className="inline-flex items-center px-2 py-0.5 text-helper rounded border border-border bg-bg/60 text-text-secondary font-mono whitespace-nowrap">
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </section>

        <div className="text-helper text-text-tertiary pt-1">
          提示:在输入框里时,字母 / 数字键不会被快捷键拦截,你可以放心输入。
        </div>
      </div>
    </Modal>
  );
}