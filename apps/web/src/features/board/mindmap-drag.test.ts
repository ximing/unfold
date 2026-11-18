import { describe, expect, it } from 'vitest';
import {
  mindmapDragRole,
  mindmapFollowerIds,
  resolveMindmapDrop,
  type MindmapDrop,
  type MindmapDropBox,
  type MindmapDropNode,
} from './mindmap-drag.js';

function box(id: string, x: number, y: number, w = 80, h = 40, z = 0): MindmapDropBox {
  return { id, x, y, w, h, z };
}

function member(id: string, parentId: string | null, order: number): MindmapDropNode {
  return { id, parentId, order, kind: 'member' };
}

function at(drop: MindmapDrop, id: string) {
  expect(drop.type).toBe('structure');
  if (drop.type !== 'structure') throw new Error(drop.type);
  const item = drop.items.find((entry) => entry.nodeId === id);
  if (!item) throw new Error(id);
  return item;
}

describe('resolveMindmapDrop', () => {
  const parent = member('p', null, 0);
  const upper = member('a', 'p', 0);
  const lower = member('b', 'p', 1);
  const dragged = member('c', 'p', 2);
  const nodes = [parent, upper, lower, dragged];
  const upperBox = box('a', 0, 0);
  const lowerBox = box('b', 0, 80);
  const draggedBox = box('c', 0, 40, 80, 40, 5);

  it('缝命中插在两者之间，x 在并集外则不是缝', () => {
    const hit = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 40, y: 60 },
      nodes,
      boxes: [upperBox, lowerBox, draggedBox],
    });
    expect(at(hit, 'c')).toEqual({ nodeId: 'c', parentId: 'p', order: 1 });
    expect(at(hit, 'a').order).toBe(0);
    expect(at(hit, 'b').order).toBe(2);
    expect(hit.type === 'structure' && hit.anchor).toBe(false);
    expect(hit.type === 'structure' ? hit.seam : null).toEqual({ x1: 0, x2: 80, y: 60 });

    const outside = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 120, y: 60 },
      nodes,
      boxes: [upperBox, lowerBox, box('c', 100, 40)],
    });
    expect(at(outside, 'c')).toEqual({ nodeId: 'c', parentId: null, order: 1 });
    expect(outside.type === 'structure' ? outside.seam : null).toBeNull();

    const edge = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 40, y: 68 },
      nodes,
      boxes: [upperBox, lowerBox, draggedBox],
    });
    expect(edge.type === 'structure' ? edge.seam : null).toBeNull();
  });

  it('左右分开的子项，空隙不是缝，命中只画指针所在的一段', () => {
    const root = member('r', null, 0);
    const left = member('c', 'r', 0);
    const right = member('a', 'r', 1);
    const dragged = member('d', null, 1);
    const nodes = [root, left, right, dragged];
    const boxes = [box('r', 48, 40, 168), box('c', -192, 0, 168), box('a', 288, 80, 168), box('d', 400, 200)];
    const gap = resolveMindmapDrop({
      draggedId: 'd',
      pointer: { x: 132, y: 60 },
      nodes,
      boxes,
    });
    expect(at(gap, 'd')).toEqual({ nodeId: 'd', parentId: 'r', order: 2 });
    expect(at(gap, 'a').order).toBe(1);
    expect(at(gap, 'c').order).toBe(0);
    expect(gap.type === 'structure' ? gap.seam : null).toBeNull();

    const onRoot = resolveMindmapDrop({
      draggedId: 'r',
      pointer: { x: 132, y: 60 },
      nodes,
      boxes,
    });
    expect(onRoot).toEqual({ type: 'anchor' });

    const onRight = resolveMindmapDrop({
      draggedId: 'd',
      pointer: { x: 300, y: 60 },
      nodes,
      boxes,
    });
    expect(at(onRight, 'd')).toEqual({ nodeId: 'd', parentId: 'r', order: 1 });
    expect(at(onRight, 'c').order).toBe(0);
    expect(at(onRight, 'a').order).toBe(2);
    expect(onRight.type === 'structure' ? onRight.seam : null).toEqual({ x1: 288, x2: 456, y: 60 });
  });

  it('缝优先于落在盒子里', () => {
    const tight = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 40, y: 44 },
      nodes,
      boxes: [box('a', 0, 0), box('b', 0, 40), box('c', 0, 20, 80, 40, 5)],
    });
    expect(at(tight, 'c')).toEqual({ nodeId: 'c', parentId: 'p', order: 1 });
    expect(tight.type === 'structure' ? tight.seam : null).toEqual({ x1: 0, x2: 80, y: 40 });
  });

  it('落入点内排到它的子项末尾，不写锚点', () => {
    const child = member('e', 'b', 0);
    const drop = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 20, y: 100 },
      nodes: [...nodes, child],
      boxes: [upperBox, lowerBox, box('e', 200, 200), box('c', 0, 80, 80, 40, 9)],
    });
    expect(at(drop, 'c')).toEqual({ nodeId: 'c', parentId: 'b', order: 1 });
    expect(at(drop, 'e').order).toBe(0);
    expect(drop.type === 'structure' && drop.anchor).toBe(false);
    expect(drop.type === 'structure' ? drop.seam : null).toBeNull();
  });

  it('空白让非根变成根，指针在自己身上也算空白', () => {
    const drop = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 20, y: 50 },
      nodes,
      boxes: [upperBox, lowerBox, box('c', 0, 40)],
    });
    expect(at(drop, 'c')).toEqual({ nodeId: 'c', parentId: null, order: 1 });
    expect(drop.type === 'structure' && drop.anchor).toBe(true);
  });

  it('根落在空白只改锚点，根缝仍改顺序并写锚点', () => {
    const roots = [member('a', null, 0), member('b', null, 1), member('c', null, 2)];
    const blank = resolveMindmapDrop({
      draggedId: 'b',
      pointer: { x: 20, y: 220 },
      nodes: roots,
      boxes: [box('a', 0, 0), box('b', 0, 200), box('c', 0, 80)],
    });
    expect(blank).toEqual({ type: 'anchor' });

    const seam = resolveMindmapDrop({
      draggedId: 'b',
      pointer: { x: 40, y: 60 },
      nodes: roots,
      boxes: [box('a', 0, 0), box('c', 0, 80), box('b', 0, 40, 80, 40, 4)],
    });
    expect(at(seam, 'b')).toEqual({ nodeId: 'b', parentId: null, order: 1 });
    expect(seam.type === 'structure' && seam.anchor).toBe(true);

    const child = resolveMindmapDrop({
      draggedId: 'd',
      pointer: { x: 40, y: 60 },
      nodes: [member('a', null, 0), member('c', null, 1), member('d', 'a', 0)],
      boxes: [box('a', 0, 0), box('c', 0, 80), box('d', 0, 40)],
    });
    expect(at(child, 'd')).toEqual({ nodeId: 'd', parentId: null, order: 1 });
    expect(child.type === 'structure' && child.anchor).toBe(true);
  });

  it('左右分开的根，空隙不是缝', () => {
    const drop = resolveMindmapDrop({
      draggedId: 'b',
      pointer: { x: 132, y: 20 },
      nodes: [member('a', null, 0), member('c', null, 1), member('b', null, 2)],
      boxes: [box('a', -192, 0, 168), box('c', 288, 0, 168), box('b', 400, 200)],
    });
    expect(drop).toEqual({ type: 'anchor' });
  });

  it('后代、芯片、上传中取消，不当成空白', () => {
    const tree = [member('a', null, 0), member('b', 'a', 0), member('c', 'b', 0)];
    const boxes = [box('a', 0, 0, 80, 40, 3), box('b', 0, 80), box('c', 300, 300)];
    const onChild = resolveMindmapDrop({
      draggedId: 'a',
      pointer: { x: 20, y: 100 },
      nodes: tree,
      boxes,
    });
    expect(onChild).toEqual({ type: 'cancel', seam: null });

    const chip = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 20, y: 50 },
      nodes: [...nodes, { id: 'inclusion:g', parentId: null, order: 0, kind: 'chip' }],
      boxes: [upperBox, lowerBox, box('c', 0, 40, 80, 40, 5), box('inclusion:g', 0, 40, 80, 40, 1)],
    });
    expect(chip).toEqual({ type: 'cancel', seam: null });

    const uploading = resolveMindmapDrop({
      draggedId: 'c',
      pointer: { x: 10, y: 10 },
      nodes: [...nodes, { id: 'uploading:1', parentId: null, order: 0, kind: 'uploading' }],
      boxes: [upperBox, lowerBox, box('uploading:1', 0, 0, 30, 30, 8), box('c', 400, 400)],
    });
    expect(uploading).toEqual({ type: 'cancel', seam: null });
  });

  it('自己的子缝取消，后代的缝也取消', () => {
    const tree = [
      member('r', null, 0),
      member('a', 'r', 0),
      member('b', 'a', 0),
      member('c', 'a', 1),
      member('d', 'b', 0),
      member('e', 'b', 1),
    ];
    const own = resolveMindmapDrop({
      draggedId: 'a',
      pointer: { x: 40, y: 60 },
      nodes: tree,
      boxes: [box('b', 0, 0), box('c', 0, 80), box('a', 200, 200)],
    });
    expect(own.type).toBe('cancel');
    expect(own.type === 'cancel' ? own.seam : null).toEqual({ x1: 0, x2: 80, y: 60 });

    const nested = resolveMindmapDrop({
      draggedId: 'a',
      pointer: { x: 40, y: 60 },
      nodes: tree,
      boxes: [box('d', 0, 0), box('e', 0, 80), box('a', 200, 200)],
    });
    expect(nested.type).toBe('cancel');
    expect(nested.type === 'cancel' ? nested.seam : null).toEqual({ x1: 0, x2: 80, y: 60 });
  });
});

describe('mindmapDragRole', () => {
  const items = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'other', parentId: null },
    { id: 'projected', parentId: 'root', groupId: 'group' },
    { id: 'inclusion:g', face: 'inclusion' as const, groupId: 'g' },
    { id: 'uploading:1', uploading: true },
  ];

  it('单个直接成员改父级，投影点只平移，混有非根则不拖', () => {
    expect(mindmapDragRole(['child'], items)).toBe('reparent');
    expect(mindmapDragRole(['root'], items)).toBe('reparent');
    expect(mindmapDragRole(['projected'], items)).toBe('places');
    expect(mindmapDragRole(['root', 'other'], items)).toBe('places');
    expect(mindmapDragRole(['root', 'child'], items)).toBe('block');
    expect(mindmapDragRole(['root', 'projected'], items)).toBe('block');
    expect(mindmapDragRole(['inclusion:g'], items)).toBe('block');
    expect(mindmapDragRole(['uploading:1'], items)).toBe('block');
  });

  it('子树含后代，不含被拖点自己的重复', () => {
    expect(
      mindmapFollowerIds('a', [
        { id: 'a', parentId: null },
        { id: 'b', parentId: 'a' },
        { id: 'c', parentId: 'b' },
        { id: 'd', parentId: null },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });
});
