/**
 * services/DiscussionService.ts 画布操作单元测试
 *
 * 覆盖 applyOps 的确定性行为(纯函数,不依赖 DB / LLM):
 *   - 分组: 新增 / 重命名 / 删除 / 标题去重
 *   - 要点: 新增(同组文本去重) / 修改 / 删除 / 移动
 *   - 容错: 引用不存在的 id 的操作被跳过,画布不受影响
 *   - 规模上限: MAX_GROUPS / MAX_POINTS 生效
 */
import { describe, it, expect } from 'vitest';
import { applyOps } from '../src/services/DiscussionService.js';
import type { DiscussionCanvas } from '../src/types/index.js';

const emptyCanvas: DiscussionCanvas = { groups: [] };

describe('applyOps - 分组操作', () => {
  it('add_group 追加分组', () => {
    const c = applyOps(emptyCanvas, [{ op: 'add_group', title: '目标用户' }]);
    expect(c.groups).toHaveLength(1);
    expect(c.groups[0]!.title).toBe('目标用户');
    expect(c.groups[0]!.points).toEqual([]);
    expect(c.groups[0]!.id).toBeTruthy();
  });

  it('add_group 相同标题去重', () => {
    const once = applyOps(emptyCanvas, [{ op: 'add_group', title: '痛点' }]);
    const twice = applyOps(once, [{ op: 'add_group', title: '痛点' }]);
    expect(twice.groups).toHaveLength(1);
  });

  it('rename_group 修改标题,无效 id 被跳过', () => {
    const c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'A' }]);
    const gid = c.groups[0]!.id;
    const renamed = applyOps(c, [{ op: 'rename_group', group_id: gid, title: 'B' }]);
    expect(renamed.groups[0]!.title).toBe('B');
    const skipped = applyOps(c, [{ op: 'rename_group', group_id: 'nope', title: 'C' }]);
    expect(skipped.groups[0]!.title).toBe('A');
  });

  it('delete_group 删除分组(连带要点)', () => {
    const c = applyOps(emptyCanvas, [
      { op: 'add_group', title: 'A' },
      { op: 'add_group', title: 'B' },
    ]);
    const gid = c.groups[0]!.id;
    const deleted = applyOps(c, [{ op: 'delete_group', group_id: gid }]);
    expect(deleted.groups).toHaveLength(1);
    expect(deleted.groups[0]!.title).toBe('B');
  });
});

describe('applyOps - 要点操作', () => {
  it('add_point 写入要点,默认状态 draft,同文本去重', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    c = applyOps(c, [
      { op: 'add_point', group_id: gid, text: '目标用户是独立开发者' },
      { op: 'add_point', group_id: gid, text: '目标用户是独立开发者' }, // 去重
      { op: 'add_point', group_id: gid, text: '痛点:缺时间验证想法', status: 'confirmed' },
    ]);
    expect(c.groups[0]!.points).toHaveLength(2);
    expect(c.groups[0]!.points[0]).toMatchObject({ text: '目标用户是独立开发者', status: 'draft' });
    expect(c.groups[0]!.points[1]).toMatchObject({ status: 'confirmed' });
  });

  it('update_point 修改文本/状态,并支持删除 note', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    c = applyOps(c, [{ op: 'add_point', group_id: gid, text: '旧内容', note: '备注' }]);
    const pid = c.groups[0]!.points[0]!.id;
    c = applyOps(c, [
      { op: 'update_point', point_id: pid, text: '新内容', status: 'question' },
      { op: 'update_point', point_id: pid, note: '' }, // 清空 note
    ]);
    expect(c.groups[0]!.points[0]).toMatchObject({ text: '新内容', status: 'question' });
    expect(c.groups[0]!.points[0]!.note).toBeUndefined();
  });

  it('delete_point 删除要点', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    c = applyOps(c, [{ op: 'add_point', group_id: gid, text: 'x' }]);
    const pid = c.groups[0]!.points[0]!.id;
    c = applyOps(c, [{ op: 'delete_point', point_id: pid }]);
    expect(c.groups[0]!.points).toHaveLength(0);
  });

  it('move_point 跨分组移动', () => {
    let c = applyOps(emptyCanvas, [
      { op: 'add_group', title: 'A' },
      { op: 'add_group', title: 'B' },
    ]);
    const [ga, gb] = c.groups.map((g) => g.id) as [string, string];
    c = applyOps(c, [{ op: 'add_point', group_id: ga, text: 'p' }]);
    const pid = c.groups[0]!.points[0]!.id;
    c = applyOps(c, [{ op: 'move_point', point_id: pid, to_group_id: gb }]);
    expect(c.groups[0]!.points).toHaveLength(0);
    expect(c.groups[1]!.points).toHaveLength(1);
    expect(c.groups[1]!.points[0]!.id).toBe(pid);
  });

  it('引用无效 id 的操作被静默跳过', () => {
    const c = applyOps(emptyCanvas, [
      { op: 'add_point', group_id: 'ghost', text: 'x' }, // 分组不存在
      { op: 'update_point', point_id: 'ghost', text: 'y' },
      { op: 'move_point', point_id: 'ghost', to_group_id: 'ghost' },
      { op: 'delete_point', point_id: 'ghost' },
    ]);
    expect(c.groups).toHaveLength(0);
  });
});

describe('applyOps - 规模上限', () => {
  it('分组数不超过 MAX_GROUPS(20)', () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      op: 'add_group' as const,
      title: `G${i}`,
    }));
    const c = applyOps(emptyCanvas, ops);
    expect(c.groups).toHaveLength(20);
  });

  it('要点总数不超过 MAX_POINTS(200)', () => {
    let c = applyOps(emptyCanvas, [{ op: 'add_group', title: 'G' }]);
    const gid = c.groups[0]!.id;
    const ops = Array.from({ length: 210 }, (_, i) => ({
      op: 'add_point' as const,
      group_id: gid,
      text: `point-${i}`,
    }));
    c = applyOps(c, ops);
    expect(c.groups[0]!.points).toHaveLength(200);
  });
});
