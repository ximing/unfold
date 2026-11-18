import { describe, expect, it } from 'vitest';
import {
  branchCubic,
  branchCurve,
  branchDraw,
  branchLinkIds,
  branchRelationPoint,
  branchPairs,
  orientBranch,
  type BranchBox,
  type BranchItem,
} from './branch-geometry.js';

describe('branchCurve', () => {
  it('父在左、子在右时，出口是父右缘中点，入口是子左缘中点', () => {
    const parent = { x: 0, y: 0, w: 100, h: 40 };
    const child = { x: 200, y: 0, w: 100, h: 40 };
    const curve = branchCurve(parent, child);
    expect(curve.p0).toEqual({ x: 100, y: 20 });
    expect(curve.p3).toEqual({ x: 200, y: 20 });
    expect(curve.p1).toEqual({ x: 145, y: 20 });
    expect(curve.p2).toEqual({ x: 155, y: 20 });
  });

  it('父在右、子在左时走相反的边', () => {
    const parent = { x: 200, y: 0, w: 100, h: 40 };
    const child = { x: 0, y: 0, w: 100, h: 40 };
    const curve = branchCurve(parent, child);
    expect(curve.p0).toEqual({ x: 200, y: 20 });
    expect(curve.p3).toEqual({ x: 100, y: 20 });
    expect(curve.p1).toEqual({ x: 155, y: 20 });
    expect(curve.p2).toEqual({ x: 145, y: 20 });
  });

  it('子在父上方时走上下边', () => {
    const parent = { x: 0, y: 200, w: 40, h: 100 };
    const child = { x: 0, y: 0, w: 40, h: 100 };
    const curve = branchCurve(parent, child);
    expect(curve.p0).toEqual({ x: 20, y: 200 });
    expect(curve.p3).toEqual({ x: 20, y: 100 });
    expect(curve.p1).toEqual({ x: 20, y: 155 });
    expect(curve.p2).toEqual({ x: 20, y: 145 });
  });

  it('|dx| 等于 |dy| 时走左右缘', () => {
    const parent = { x: 0, y: 0, w: 20, h: 20 };
    const child = { x: 40, y: 40, w: 20, h: 20 };
    const curve = branchCurve(parent, child);
    expect(curve.p0).toEqual({ x: 20, y: 10 });
    expect(curve.p3).toEqual({ x: 40, y: 50 });
  });

  it('两盒重叠仍按中心判断，不抛错，handle 不小于 24', () => {
    const parent = { x: 0, y: 0, w: 80, h: 40 };
    const child = { x: 40, y: 0, w: 80, h: 40 };
    const curve = branchCurve(parent, child);
    expect(curve.p0).toEqual({ x: 80, y: 20 });
    expect(curve.p3).toEqual({ x: 40, y: 20 });
    expect(curve.p1).toEqual({ x: 104, y: 20 });
    expect(curve.p2).toEqual({ x: 16, y: 20 });
    expect(Math.hypot(curve.p1.x - curve.p0.x, curve.p1.y - curve.p0.y)).toBe(24);
  });

  it('子在右侧但高出很多时，控制点不交叉', () => {
    const parent = { x: 0, y: 80, w: 220, h: 80 };
    const child = { x: 292, y: 0, w: 168, h: 56 };
    const curve = branchCurve(parent, child);
    expect(curve.p0).toEqual({ x: 220, y: 120 });
    expect(curve.p3).toEqual({ x: 292, y: 28 });
    expect(curve.p1.x).toBeLessThanOrEqual(curve.p2.x);
    expect(curve.p1.y).toBe(120);
    expect(curve.p2.y).toBeGreaterThan(curve.p3.y);
    expect(curve.p1.x - curve.p0.x).toBeCloseTo(36);
  });

  it('handle 不超过 160', () => {
    const parent = { x: 0, y: 0, w: 10, h: 10 };
    const child = { x: 400, y: 0, w: 10, h: 10 };
    const curve = branchCurve(parent, child);
    expect(curve.p0).toEqual({ x: 10, y: 5 });
    expect(curve.p3).toEqual({ x: 400, y: 5 });
    expect(curve.p1).toEqual({ x: 170, y: 5 });
    expect(curve.p2).toEqual({ x: 240, y: 5 });
    expect(Math.hypot(curve.p1.x - curve.p0.x, curve.p1.y - curve.p0.y)).toBe(160);
  });
});

describe('branchDraw', () => {
  it('箭头尖端在子入口，笔画沿到达方向退开', () => {
    const parent = { x: 0, y: 0, w: 100, h: 40 };
    const child = { x: 200, y: 0, w: 100, h: 40 };
    const curve = branchCurve(parent, child);
    const stroke = branchDraw(curve, 8);
    expect(stroke.tip.x).toBeCloseTo(200);
    expect(stroke.tip.y).toBeCloseTo(20);
    expect(stroke.tip.ux).toBeCloseTo(1);
    expect(stroke.tip.uy).toBeCloseTo(0);
    expect(stroke.end.x).toBeCloseTo(192);
    expect(stroke.end.y).toBeCloseTo(20);
  });

  it('子高出父级时，箭头顺着来向，线尾是箭头底边中点', () => {
    const parent = { x: 0, y: 80, w: 220, h: 80 };
    const child = { x: 292, y: 0, w: 168, h: 56 };
    const curve = branchCurve(parent, child);
    const stroke = branchDraw(curve, 10);
    expect(stroke.tip.ux).toBeGreaterThan(0.4);
    expect(stroke.tip.uy).toBeLessThan(-0.4);
    expect(stroke.end.x).toBeGreaterThan(curve.p0.x);
    const baseX = stroke.tip.x - stroke.tip.ux * 10;
    const baseY = stroke.tip.y - stroke.tip.uy * 10;
    expect(stroke.end.x).toBeCloseTo(baseX);
    expect(stroke.end.y).toBeCloseTo(baseY);
  });

  it('反向联系的箭头回到父级', () => {
    const curve = orientBranch(branchCurve({ x: 0, y: 0, w: 100, h: 40 }, { x: 200, y: 0, w: 100, h: 40 }), false);
    const stroke = branchDraw(curve, 8);
    expect(stroke.tip).toEqual({ x: 100, y: 20, ux: -1, uy: 0 });
    expect(stroke.end.x).toBeGreaterThan(100);
  });
});

describe('branchRelationPoint', () => {
  it('父子联系的中点在两点之间，无关的两端没有', () => {
    const items: BranchItem[] = [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ];
    const boxes = new Map<string, BranchBox>([
      ['root', { x: 0, y: 0, w: 100, h: 40 }],
      ['child', { x: 200, y: 0, w: 100, h: 40 }],
    ]);
    const mid = branchRelationPoint(items, boxes, 'root', 'child');
    expect(mid?.x).toBeGreaterThan(100);
    expect(mid?.x).toBeLessThan(200);
    expect(mid?.y).toBeCloseTo(20);
    expect(branchRelationPoint(items, boxes, 'child', 'root')?.y).toBeCloseTo(20);
    expect(branchRelationPoint(items, boxes, 'root', 'other')).toBeNull();
  });
});

describe('branchLinkIds', () => {
  it('父子之间两个方向的联系都算在分支上', () => {
    const items: BranchItem[] = [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ];
    const ids = branchLinkIds(items, boxesOf(['root', 'child']), [
      { id: 'e1', fromId: 'root', toId: 'child' },
      { id: 'e2', fromId: 'child', toId: 'root' },
      { id: 'e3', fromId: 'root', toId: 'other' },
    ]);
    expect([...ids].sort()).toEqual(['e1', 'e2']);
  });
});

describe('branchCubic', () => {
  it('以 M 开头且包含 C，坐标用最短十进制', () => {
    const parent = { x: 0, y: 0, w: 100, h: 40 };
    const child = { x: 200, y: 0, w: 100, h: 40 };
    const path = branchCubic(parent, child);
    expect(path.startsWith('M')).toBe(true);
    expect(path.includes('C')).toBe(true);
    expect(path).toBe('M 100 20 C 145 20 155 20 200 20');
  });
});

const box: BranchBox = { x: 0, y: 0, w: 10, h: 10 };

function boxesOf(ids: readonly string[]): Map<string, BranchBox> {
  return new Map(ids.map((id) => [id, box]));
}

describe('branchPairs', () => {
  it('选中直接成员的父子', () => {
    const items: BranchItem[] = [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
      { id: 'grand', parentId: 'child' },
    ];
    expect(branchPairs(items, boxesOf(['root', 'child', 'grand']))).toEqual([
      { parentId: 'root', childId: 'child' },
      { parentId: 'child', childId: 'grand' },
    ]);
  });

  it('缺父、投影点和收起的子集合不画', () => {
    const items: BranchItem[] = [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
      { id: 'orphan', parentId: null },
      { id: 'projected', parentId: 'root', groupId: 'group' },
      { id: 'nested', parentId: 'projected' },
      { id: 'chip', parentId: 'root', face: 'inclusion' },
      { id: 'under-chip', parentId: 'chip' },
    ];
    expect(branchPairs(items, boxesOf(items.map((item) => item.id)))).toEqual([
      { parentId: 'root', childId: 'child' },
    ]);
  });

  it('父项不在列表里则没有这一段', () => {
    const items: BranchItem[] = [{ id: 'child', parentId: 'missing' }];
    expect(branchPairs(items, boxesOf(['child', 'missing']))).toEqual([]);
  });

  it('缺盒子不画这一段', () => {
    const items: BranchItem[] = [
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ];
    expect(branchPairs(items, boxesOf(['root']))).toEqual([]);
    expect(branchPairs(items, boxesOf(['child']))).toEqual([]);
  });
});
