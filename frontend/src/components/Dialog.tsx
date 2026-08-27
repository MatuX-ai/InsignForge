/**
 * 全局 Dialog Provider - Promise 风格 confirm/alert
 * 替代浏览器原生 window.confirm / window.alert,保持玻璃拟态主题一致性。
 *
 * 使用方式:
 *   const dialog = useDialog();
 *   if (await dialog.confirm({ title: '...', message: '...', tone: 'danger' })) { ... }
 *   await dialog.alert({ title: '...', message: '...' });
 *
 * 需在应用根节点包裹 <DialogProvider>。
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { Modal } from './Modal';

export type DialogTone = 'primary' | 'warning' | 'danger';
export type DialogKind = 'confirm' | 'alert';

export interface DialogOptions {
  title: string;
  message: ReactNode;
  primaryLabel?: string;
  secondaryLabel?: string;
  tone?: DialogTone;
}

interface DialogState extends DialogOptions {
  kind: DialogKind;
  /** 内部使用,confirm 时 resolve(true|false),alert 时 resolve(undefined) */
  resolve: (v: boolean | void) => void;
}

export interface DialogApi {
  confirm: (options: DialogOptions) => Promise<boolean>;
  alert: (options: DialogOptions) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback((options: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, kind: 'confirm', resolve: resolve as (v: boolean | void) => void });
    });
  }, []);

  const alert = useCallback((options: DialogOptions) => {
    return new Promise<void>((resolve) => {
      // 包装一层,避免 boolean 流入 void 类型 resolve
      setState({ ...options, kind: 'alert', resolve: () => resolve() });
    });
  }, []);

  const close = useCallback((result: boolean | void) => {
    setState((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state && (
        <Modal
          open
          title={state.title}
          onClose={() => close(state.kind === 'confirm' ? false : undefined)}
          tone={state.tone ?? 'primary'}
          primaryLabel={
            state.primaryLabel ?? (state.kind === 'confirm' ? '确定' : '知道了')
          }
          onPrimary={() => close(state.kind === 'confirm' ? true : undefined)}
          secondaryLabel={
            state.kind === 'confirm' ? state.secondaryLabel ?? '取消' : undefined
          }
          onSecondary={() => close(false)}
          maskClosable={state.kind === 'alert'}
        >
          <div className="text-body text-text-secondary whitespace-pre-wrap">
            {state.message}
          </div>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within <DialogProvider>');
  }
  return ctx;
}