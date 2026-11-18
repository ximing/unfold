import { describe, expect, it } from 'vitest';
import {
  MINDMAP_LEVEL_GAP,
  MINDMAP_ORIGIN_X,
  MINDMAP_ORIGIN_Y,
  MINDMAP_ROOT_GAP,
  MINDMAP_SIBLING_GAP,
  layoutMindmap,
} from './mindmap-layout.js';
import type { MindmapNode } from './mindmap-layout.js';
import { anchorForRootDrop, anchorFromDrop, mindmapPlacements } from './mindmap-place.js';

const tree: MindmapNode[] = [
  { id: 'R', parentId: null, order: 0, side: null, w: 168, h: 56 },
  { id: 'A', parentId: 'R', order: 0, side: null, w: 168, h: 56 },
  { id: 'B', parentId: 'R', order: 1, side: null, w: 168, h: 74 },
];

function laid(anchor: { x: number; y: number }) {
  return layoutMindmap({
    nodes: tree,
    folded: new Set<string>(),
    direction: 'right',
    anchors: new Map([['R', anchor]]),
    rootGap: MINDMAP_ROOT_GAP,
    levelGap: MINDMAP_LEVEL_GAP,
    siblingGap: MINDMAP_SIBLING_GAP,
    originX: MINDMAP_ORIGIN_X,
    originY: MINDMAP_ORIGIN_Y,
  });
}

describe('mindmapPlacements', () => {
  it('锚点 (48, 48) 时写库的是锚点，不是根盒子的 y', () => {
    const boxes = laid({ x: 48, y: 48 });
    expect(boxes.find((box) => box.id === 'R')?.y).toBe(93);
    const writes = mindmapPlacements(
      [
        { id: 'R', parentId: null, x: null, y: null, z: 4 },
        { id: 'A', parentId: 'R', x: null, y: null, z: null },
        { id: 'B', parentId: 'R', x: null, y: null, z: 1 },
      ],
      boxes,
    );
    expect(writes).toEqual([
      { nodeId: 'R', x: 48, y: 48, z: 4 },
      { nodeId: 'A', x: 288, y: 48, z: 0 },
      { nodeId: 'B', x: 288, y: 120, z: 1 },
    ]);
    expect(writes.find((item) => item.nodeId === 'R')?.y).not.toBe(93);
  });

  it('差 0.4px 不写，差 0.5px 要写', () => {
    const boxes = [
      { id: 'R', x: 0, y: 10 },
      { id: 'A', x: 30, y: 0 },
    ];
    const root = { id: 'R', parentId: null, x: 0, y: 0, z: 1 };
    const child = { id: 'A', parentId: 'R', x: 30, y: 0, z: 2 };
    expect(mindmapPlacements([root, child], boxes)).toEqual([]);
    expect(mindmapPlacements([{ ...root, y: 0.4 }, child], boxes)).toEqual([]);
    expect(mindmapPlacements([root, { ...child, x: 30.4 }], boxes)).toEqual([]);
    expect(mindmapPlacements([{ ...root, y: 0.5 }, child], boxes)).toEqual([
      { nodeId: 'R', x: 0, y: 0, z: 1 },
    ]);
    expect(mindmapPlacements([root, { ...child, x: 30.5 }], boxes)).toEqual([
      { nodeId: 'A', x: 30, y: 0, z: 2 },
    ]);
  });

  it('空布局不产生写入', () => {
    expect(
      mindmapPlacements([{ id: 'R', parentId: null, x: 1, y: 2, z: 0 }], []),
    ).toEqual([]);
  });

  it('缺父的点不当成根，也不写', () => {
    expect(
      mindmapPlacements([{ id: 'A', parentId: 'missing', x: null, y: null, z: 0 }], [{ id: 'A', x: 1, y: 2 }]),
    ).toEqual([]);
  });
});

describe('anchorFromDrop', () => {
  it('落点试算后把锚点抬上去，根盒子才留在落点', () => {
    const drop = { x: 48, y: 48 };
    const trial = laid(drop);
    const rootBox = trial.find((box) => box.id === 'R');
    expect(rootBox).toMatchObject({ x: 48, y: 93 });
    const anchor = anchorFromDrop(drop, rootBox ?? drop, drop);
    expect(anchor).toEqual({ x: 48, y: 3 });
    const placed = laid(anchor);
    expect(placed.find((box) => box.id === 'R')).toMatchObject({ x: 48, y: 48 });
    const stored = mindmapPlacements(
      [
        { id: 'R', parentId: null, x: null, y: null, z: 0 },
        { id: 'A', parentId: 'R', x: null, y: null, z: 0 },
        { id: 'B', parentId: 'R', x: null, y: null, z: 0 },
      ],
      placed,
    );
    expect(stored.find((item) => item.nodeId === 'R')).toMatchObject({ x: 48, y: 3 });
  });
});

describe('anchorForRootDrop', () => {
  it('新根的盒子留在落点，已有根的锚点不动', () => {
    const nodes: MindmapNode[] = [
      ...tree,
      { id: 'N', parentId: null, order: 1, side: null, w: 168, h: 56 },
    ];
    const stored = new Map([['R', { x: 48, y: 48 }]]);
    const drop = { x: 500, y: 400 };
    const anchors = anchorForRootDrop(stored, 'N', drop, (trial) =>
      layoutMindmap({
        nodes,
        folded: new Set<string>(),
        direction: 'right',
        anchors: trial,
        rootGap: MINDMAP_ROOT_GAP,
        levelGap: MINDMAP_LEVEL_GAP,
        siblingGap: MINDMAP_SIBLING_GAP,
        originX: MINDMAP_ORIGIN_X,
        originY: MINDMAP_ORIGIN_Y,
      }),
    );
    expect(anchors?.get('R')).toEqual({ x: 48, y: 48 });
    expect(anchors?.get('N')).toEqual(drop);
    const placed = layoutMindmap({
      nodes,
      folded: new Set<string>(),
      direction: 'right',
      anchors: anchors ?? new Map(),
      rootGap: MINDMAP_ROOT_GAP,
      levelGap: MINDMAP_LEVEL_GAP,
      siblingGap: MINDMAP_SIBLING_GAP,
      originX: MINDMAP_ORIGIN_X,
      originY: MINDMAP_ORIGIN_Y,
    });
    expect(placed.find((box) => box.id === 'N')).toMatchObject(drop);
    expect(placed.find((box) => box.id === 'R')?.y).toBe(93);
  });
});
