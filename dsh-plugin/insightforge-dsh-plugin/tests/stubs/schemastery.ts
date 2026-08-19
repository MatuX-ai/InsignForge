/**
 * schemastery stub —— 提供最小 schema 构造器
 *
 * 实际 schemastery 提供完整的 union/number/boolean 校验,
 * 此处只满足 .required() / .default() / .description() 链式调用与校验返回。
 *
 * 同时导出 default 与 named Schema 以兼容两种 import 方式。
 */

type AnySchema = AnySchemaChain & ((value: unknown) => unknown);

interface AnySchemaChain {
  required(): AnySchema;
  default(v: unknown): AnySchema;
  description(s: string): AnySchema;
  min(n: number): AnySchema;
  max(n: number): AnySchema;
  range(from: number, to: number): AnySchema;
}

function makeSchema(): AnySchema {
  const s: AnySchema = ((v: unknown) => v) as AnySchema;
  s.required = () => s;
  s.default = () => s;
  s.description = () => s;
  s.min = () => s;
  s.max = () => s;
  s.range = () => s;
  return s;
}

const SchemaImpl = {
  string: makeSchema,
  number: makeSchema,
  boolean: makeSchema,
  literal: (_v: unknown) => makeSchema(),
  union: (..._schemas: unknown[]) => makeSchema(),
  object: (_shape: Record<string, unknown>) => makeSchema(),
  array: (_inner: unknown) => makeSchema(),
};

// 同时支持 default 与 named import
export const Schema = SchemaImpl;
export default SchemaImpl;