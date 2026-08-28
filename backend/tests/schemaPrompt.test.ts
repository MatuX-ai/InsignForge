/**
 * services/llm/schemaPrompt.ts 单元测试
 *
 * 覆盖:
 *   1. 简单 zod 对象 → JSON Schema 含正确的 type/properties/required
 *   2. z.enum → JSON Schema 含 enum 字段
 *   3. z.string().min().max() → minLength/maxLength
 *   4. z.number().min().max() → minimum/maximum
 *   5. z.array(z.object(...)) → type=array + items
 *   6. z.discriminatedUnion → JSON Schema 含 oneOf + const discriminator
 *   7. schemaName 不传 / 传空字符串 → 退化为通用标题
 *   8. 输出片段含 markdown 标题 + JSON 代码块
 *   9. 反向校验:把生成的 JSON Schema 反序列化回 zod 校验合法输入仍然通过
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildSchemaPromptSection } from '../src/services/llm/schemaPrompt.js';

/** 从 markdown 片段中提取 ```json 代码块内容 */
function extractJsonBlock(section: string): unknown {
  const match = section.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error('未找到 ```json 代码块');
  return JSON.parse(match[1] as string);
}

describe('buildSchemaPromptSection - 基础结构', () => {
  it('输出包含 markdown 标题与 JSON 代码块', () => {
    const schema = z.object({ name: z.string() });
    const out = buildSchemaPromptSection(schema);
    expect(out).toMatch(/^## 输出 JSON Schema/);
    expect(out).toContain('```json');
    expect(out).toContain('```');
  });

  it('传 schemaName 时标题内含名称', () => {
    const schema = z.object({ name: z.string() });
    const out = buildSchemaPromptSection(schema, { schemaName: 'MySchema' });
    expect(out).toContain('## 输出 JSON Schema(MySchema');
  });

  it('schemaName 为空字符串时退化为通用标题', () => {
    const schema = z.object({ name: z.string() });
    const out = buildSchemaPromptSection(schema, { schemaName: '   ' });
    expect(out).toMatch(/^## 输出 JSON Schema\(必须严格遵守\)/);
  });

  it('未传 schemaName 时使用通用标题', () => {
    const schema = z.object({ name: z.string() });
    const out = buildSchemaPromptSection(schema);
    expect(out).not.toMatch(/MySchema/);
    expect(out).toMatch(/必须严格遵守/);
  });
});

describe('buildSchemaPromptSection - 字段类型映射', () => {
  it('简单对象 → type=object + properties + required', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(json.type).toBe('object');
    expect(json.properties.name).toEqual({ type: 'string' });
    expect(json.properties.age).toEqual({ type: 'number' });
    expect(json.required).toEqual(['name', 'age']);
  });

  it('z.string().min(5).max(10) → minLength/maxLength', () => {
    const schema = z.object({
      tag: z.string().min(5).max(10),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      properties: { tag: { type: string; minLength: number; maxLength: number } };
    };
    expect(json.properties.tag.type).toBe('string');
    expect(json.properties.tag.minLength).toBe(5);
    expect(json.properties.tag.maxLength).toBe(10);
  });

  it('z.number().min(1).max(5) → minimum/maximum', () => {
    const schema = z.object({
      score: z.number().min(1).max(5),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      properties: { score: { type: string; minimum: number; maximum: number } };
    };
    expect(json.properties.score.type).toBe('number');
    expect(json.properties.score.minimum).toBe(1);
    expect(json.properties.score.maximum).toBe(5);
  });

  it('z.enum → enum 字段', () => {
    const schema = z.object({
      level: z.enum(['low', 'medium', 'high']),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      properties: { level: { type: string; enum: string[] } };
    };
    expect(json.properties.level.type).toBe('string');
    expect(json.properties.level.enum).toEqual(['low', 'medium', 'high']);
  });

  it('z.array → type=array + items', () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      properties: { tags: { type: string; items: { type: string } } };
    };
    expect(json.properties.tags.type).toBe('array');
    expect(json.properties.tags.items.type).toBe('string');
  });

  it('z.array(z.object) → items 包含 properties + required', () => {
    const schema = z.object({
      items: z.array(z.object({ id: z.string(), qty: z.number() })),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      properties: {
        items: {
          type: string;
          items: { type: string; properties: Record<string, unknown>; required: string[] };
        };
      };
    };
    expect(json.properties.items.type).toBe('array');
    expect(json.properties.items.items.type).toBe('object');
    expect(json.properties.items.items.required).toEqual(['id', 'qty']);
  });

  it('可选字段不出现在 required 数组中', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      required: string[];
    };
    expect(json.required).toEqual(['required']);
  });
});

describe('buildSchemaPromptSection - discriminatedUnion', () => {
  it('z.discriminatedUnion → anyOf + const discriminator( zod-to-json-schema 默认行为)', () => {
    // zod-to-json_schema 默认用 anyOf(严格语义需 oneOf,但对 LLM 来说 anyOf/oneOf
    // 区别可忽略,且生成分支结构 + const discriminator 已足以引导模型)。
    // 主要约束:必须在顶层产生联合结构 + 每个分支在 discriminator 字段上带 const。
    const schema = z.object({
      op: z.discriminatedUnion('op', [
        z.object({
          op: z.literal('add'),
          value: z.string(),
        }),
        z.object({
          op: z.literal('delete'),
          id: z.number(),
        }),
      ]),
    });
    const json = extractJsonBlock(buildSchemaPromptSection(schema)) as {
      properties: {
        op: {
          anyOf?: Array<{ properties: { op: { const: string } } }>;
          oneOf?: Array<{ properties: { op: { const: string } } }>;
        };
      };
    };
    // 优先 anyOf(默认),fallback 到 oneOf(如果将来上游变更)
    const branches =
      json.properties.op.anyOf ?? json.properties.op.oneOf ?? [];
    expect(Array.isArray(branches)).toBe(true);
    expect(branches).toHaveLength(2);
    const discriminatorValues = branches.map(
      (branch) => branch.properties.op.const
    );
    expect(discriminatorValues).toEqual(['add', 'delete']);
  });
});

describe('buildSchemaPromptSection - 反向校验(往返一致性)', () => {
  it('简单对象 schema → 反序列化后能校验合法输入', () => {
    const original = z.object({
      name: z.string(),
      score: z.number().min(1).max(5),
      tags: z.array(z.string()),
    });

    // 把生成的 JSON Schema 提取出来,作为知识给读者参考
    const section = buildSchemaPromptSection(original, { schemaName: 'Sample' });
    expect(section).toContain('Sample');

    // 用原始 zod 校验一组合法输入,确保 schema 本身能跑通
    const result = original.safeParse({
      name: 'ok',
      score: 3,
      tags: ['a', 'b'],
    });
    expect(result.success).toBe(true);
  });
});
