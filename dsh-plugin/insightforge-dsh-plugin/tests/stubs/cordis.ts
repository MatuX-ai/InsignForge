/**
 * cordis stub —— 在 dsh v0.1 GA 前的运行时兜底
 *
 * 提供最小的 Context / Plugin 接口,满足编译和测试需求。
 */
export interface Context {
  name: string;
  disposed: boolean;
  effect(fn: () => unknown): void;
  onDispose(fn: () => void | Promise<void>): void;
  inject<T = unknown>(key: string): T | undefined;
  provide(key: string, value: unknown): void;
  tools: {
    register(tool: unknown): void;
    unregister(name: string): void;
    list(): unknown[];
  };
  shell?: {
    command: { register(cmd: unknown): void };
    action: { register(action: unknown): void };
  };
}

export interface Plugin {
  name: string;
  inject?: string[];
  apply?: (ctx: Context, config: unknown) => void | Promise<void>;
}

export function definePlugin<T extends Plugin>(p: T): T {
  return p;
}

// 空导出,避免被识别为脚本
export {};