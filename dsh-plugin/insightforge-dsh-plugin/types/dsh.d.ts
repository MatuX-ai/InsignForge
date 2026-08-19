/**
 * 兜底类型声明 (Fallback Type Declarations)
 *
 * 背景:DeepSeek Harness v0.1 开发者预览版(2026-08-13)刚发布,
 * `@deepseek-ai/cordis` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery`
 * 包尚未在 npm 公共 registry 中稳定提供。本文件提供 TypeScript 类型层面的
 * 兜底,确保插件可以独立完成 typecheck 与测试。
 *
 * 一旦 dsh v0.1 GA 且官方 npm 包可用:
 * 1. 在 `package.json` 中移除 `peerDependenciesMeta` 中的 `optional: true`
 * 2. 删除本文件,或保留作为 `.d.ts` 参考实现
 * 3. `tsconfig.json` 中的 `paths` 映射可移除
 *
 * 本兜底基于需求文档(4.3/4.4/4.6/5.2 节)与 dsh-trail-plugin 公开规范推断,
 * 可能与最终 API 存在细微差异,届时以官方实现为准。
 */

// ============================================================
// @deepseek-ai/schemastery - 配置校验 Schema DSL
// ============================================================
declare module '@deepseek-ai/schemastery' {
  type Validator<T> = (input: unknown) => T;
  interface SchemaType<T> {
    (input: unknown): T;
    default(value: T): SchemaType<T>;
    required(): SchemaType<T>;
    description(text: string): SchemaType<T>;
    role(role: string): SchemaType<T>;
    validate(input: unknown): T;
  }

  interface NumberSchema extends SchemaType<number> {
    min(n: number): NumberSchema;
    max(n: number): NumberSchema;
    range(min: number, max: number): NumberSchema;
  }

  interface StringSchema extends SchemaType<string> {
    min(n: number): StringSchema;
    max(n: number): StringSchema;
    pattern(re: RegExp): StringSchema;
  }

  interface ArraySchema<T> extends SchemaType<T[]> {
    length(n: number): ArraySchema<T>;
  }

  interface ObjectSchema<T> extends SchemaType<T> {}

  interface SchemaConstructor {
    object<T extends Record<string, unknown>>(shape: {
      [K in keyof T]: AnySchema;
    }): ObjectSchema<T>;
    string(): StringSchema;
    number(): NumberSchema;
    boolean(): SchemaType<boolean>;
    array<T>(item: AnySchema): ArraySchema<T>;
    union<T extends readonly unknown[]>(...items: { [K in keyof T]: AnySchema }): SchemaType<T[number]>;
    literal<T extends string | number | boolean>(value: T): SchemaType<T>;
    dict<V>(value: AnySchema): SchemaType<Record<string, V>>;
    any(): SchemaType<unknown>;
    never(): SchemaType<never>;
    const<T>(value: T): SchemaType<T>;
  }

  type AnySchema =
    | StringSchema
    | NumberSchema
    | SchemaType<boolean>
    | ObjectSchema<any>
    | ArraySchema<any>
    | SchemaType<unknown>;

  const Schema: SchemaConstructor;
  export default Schema;
  export class ValidationError extends Error {
    issues: Array<{ path: (string | number)[]; message: string }>;
  }
}

// ============================================================
// @deepseek-ai/cordis - 插件框架
// ============================================================
declare module '@deepseek-ai/cordis' {
  /**
   * 插件上下文,提供依赖注入与生命周期管理
   */
  export interface Context {
    /** 当前插件名 */
    readonly name: string;
    /** 框架是否已 disposed */
    readonly disposed: boolean;
    /** 注册副作用,框架 dispose 时自动清理(等价于 defer) */
    effect(fn: () => void | (() => void) | Promise<void | (() => void)>): void;
    /** 注册清理回调 */
    onDispose(fn: () => void | Promise<void>): void;
    /** 从其他插件获取已 provide 的服务(类型擦除,运行时检查) */
    inject<T = unknown>(key: string): T;
    /** 向 ctx 注入可被其他插件依赖的服务 */
    provide(key: string, value: unknown): void;
    /** 通用 registry —— dsh 在 ctx.tools / ctx.shell / ctx.logger 等子键上挂载各种 service */
    readonly [serviceKey: string]: any;
  }

  /** 工具注册表 */
  export interface ToolRegistry {
    register(tool: ToolDefinition): void;
    unregister(name: string): void;
    list(): ToolDefinition[];
  }

  /** Shell 扩展点 */
  export interface Shell {
    command: { register(cmd: { name: string; description?: string; handler: (args: string) => void | Promise<void> }): void };
    action: { register(action: { id: string; label?: string; icon?: string; onClick: () => void | Promise<void> }): void };
    overlay: { register(overlay: { id: string; render: () => unknown }): void };
  }

  /** 插件定义接口 */
  export interface Plugin<TConfig = any> {
    name: string;
    inject?: string[];
    Config?: import('@deepseek-ai/schemastery').ObjectSchema<TConfig>;
    apply: (ctx: Context, config: TConfig) => void | Promise<void>;
  }

  export type { ToolDefinition } from '@deepseek-ai/dsh-tools';
}

// ============================================================
// @deepseek-ai/dsh-tools - 工具定义
// ============================================================
declare module '@deepseek-ai/dsh-tools' {
  export interface ToolParameter {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required?: boolean;
    description?: string;
    enum?: readonly unknown[];
    default?: unknown;
    items?: ToolParameter;
    properties?: Record<string, ToolParameter>;
  }

  export interface ToolParameters {
    [key: string]: ToolParameter;
  }

  export interface ToolRenderFragment {
    type: 'text' | 'markdown' | 'json' | 'html';
    text?: string;
    data?: unknown;
  }

  export interface ToolRenderResult {
    title?: string;
    fragments: ToolRenderFragment[];
  }

  export interface ToolDefinition<TArgs = any, TOutput = any> {
    name: string;
    description: string;
    parameters: ToolParameters;
    output?: {
      schema?: unknown;
      render?: (args: TArgs, value: TOutput) => ToolRenderResult | ToolRenderFragment[];
    };
    execute?: (args: TArgs, exec?: ToolExecutionContext) => Promise<TOutput>;
  }

  export interface ToolExecutionContext {
    agent?: { id: string; workspace?: string };
    sessionId?: string;
    logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
    signal?: AbortSignal;
  }

  export function defineTool<TArgs, TOutput>(tool: ToolDefinition<TArgs, TOutput>): ToolDefinition<TArgs, TOutput>;
}