/**
 * dsh-tools stub —— 提供 defineTool / Tool 接口
 */
export interface Tool<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  parameters: unknown;
  execute(params: TParams): Promise<TResult>;
}

export function defineTool<T extends Tool>(t: T): T {
  return t;
}

export {};