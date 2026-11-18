import { describe, expect, it } from 'vitest';
import { textNodeHeight } from './board-layout.js';
import { imageFrame } from './image-frame.js';
import {
  MINDMAP_LEVEL_GAP,
  MINDMAP_ORIGIN_X,
  MINDMAP_ORIGIN_Y,
  MINDMAP_ROOT_GAP,
  MINDMAP_SIBLING_GAP,
  layoutMindmap,
  separateFromObstacles,
} from './mindmap-layout.js';
import type { MindmapBox, MindmapDirection, MindmapInput, MindmapNode } from './mindmap-layout.js';

function point(
  id: string,
  parentId: string | null,
  order = 0,
  w = 168,
  h = 56,
  side: MindmapNode['side'] = null,
): MindmapNode {
  return { id, parentId, order, side, w, h };
}

function layout(
  nodes: readonly MindmapNode[],
  patch: Partial<Omit<MindmapInput, 'nodes'>> = {},
): MindmapBox[] {
  return layoutMindmap({
    nodes,
    folded: patch.folded ?? new Set<string>(),
    direction: patch.direction ?? 'right',
    anchors: patch.anchors ?? new Map(),
    rootGap: patch.rootGap ?? MINDMAP_ROOT_GAP,
    levelGap: patch.levelGap ?? MINDMAP_LEVEL_GAP,
    siblingGap: patch.siblingGap ?? MINDMAP_SIBLING_GAP,
    originX: patch.originX ?? MINDMAP_ORIGIN_X,
    originY: patch.originY ?? MINDMAP_ORIGIN_Y,
    levelExtra: patch.levelExtra,
  });
}

function at(boxes: readonly MindmapBox[], id: string): MindmapBox | undefined {
  return boxes.find((box) => box.id === id);
}

function anchor(id: string, x: number, y: number): Map<string, { x: number; y: number }> {
  return new Map([[id, { x, y }]]);
}

const rightTree = [
  point('R', null),
  point('A', 'R', 0, 168, 56),
  point('B', 'R', 1, 168, 74),
];

describe('layoutMindmap', () => {
  it('常量是规格里的缝和原点', () => {
    expect(MINDMAP_ROOT_GAP).toBe(96);
    expect(MINDMAP_LEVEL_GAP).toBe(72);
    expect(MINDMAP_SIBLING_GAP).toBe(16);
    expect(MINDMAP_ORIGIN_X).toBe(48);
    expect(MINDMAP_ORIGIN_Y).toBe(48);
  });

  it('向右时根垂直居中，子项按缝叠在右侧', () => {
    const boxes = layout(rightTree, { anchors: anchor('R', 48, 48) });
    expect(at(boxes, 'R')).toEqual({ id: 'R', x: 48, y: 93, w: 168, h: 56 });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: 288, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'B')).toEqual({ id: 'B', x: 288, y: 120, w: 168, h: 74 });
  });

  it('父子联系加宽这一层，兄弟仍对齐，根不动', () => {
    const boxes = layout(rightTree, { anchors: anchor('R', 48, 48), levelExtra: new Map([['R', 38]]) });
    expect(at(boxes, 'R')).toMatchObject({ x: 48, y: 93 });
    expect(at(boxes, 'A')).toMatchObject({ x: 326, y: 48 });
    expect(at(boxes, 'B')).toMatchObject({ x: 326, y: 120 });
  });

  it('孙项的加宽不挪父级那一列', () => {
    const boxes = layout([...rightTree, point('A1', 'A')], {
      anchors: anchor('R', 48, 48),
      levelExtra: new Map([['A', 30]]),
    });
    expect(at(boxes, 'A')?.x).toBe(288);
    expect(at(boxes, 'A1')?.x).toBe(288 + 168 + MINDMAP_LEVEL_GAP + 30);
  });

  it('向左时加宽仍留在父级外侧', () => {
    const boxes = layout(rightTree, {
      direction: 'left',
      anchors: anchor('R', 48, 48),
      levelExtra: new Map([['R', 40]]),
    });
    expect(at(boxes, 'R')).toMatchObject({ x: 48, y: 93 });
    expect(at(boxes, 'A')).toMatchObject({ x: -232, y: 48 });
    expect(at(boxes, 'B')?.x).toBe(-232);
  });

  it('不是正数的加宽不加', () => {
    const boxes = layout(rightTree, { anchors: anchor('R', 48, 48), levelExtra: new Map([['R', -10]]) });
    expect(at(boxes, 'A')?.x).toBe(288);
  });

  it('一个子项时缝是 0', () => {
    const boxes = layout([point('R', null), point('A', 'R')], { anchors: anchor('R', 48, 48) });
    expect(at(boxes, 'R')).toEqual({ id: 'R', x: 48, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: 288, y: 48, w: 168, h: 56 });
  });

  it('没有子项时子树高就是点的高', () => {
    const boxes = layout([point('R', null, 0, 168, 74)]);
    expect(boxes).toEqual([{ id: 'R', x: 48, y: 48, w: 168, h: 74 }]);
  });

  it('向左时绕根中线镜像，根留在锚点', () => {
    const boxes = layout(rightTree, { direction: 'left', anchors: anchor('R', 48, 48) });
    expect(at(boxes, 'R')).toEqual({ id: 'R', x: 48, y: 93, w: 168, h: 56 });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: -192, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'B')).toEqual({ id: 'B', x: -192, y: 120, w: 168, h: 74 });
  });

  it('向左时不看 side，整棵树镜像', () => {
    const boxes = layout(
      [point('R', null), point('A', 'R', 0, 168, 56, 'right')],
      { direction: 'left', anchors: anchor('R', 48, 48) },
    );
    expect(at(boxes, 'A')?.x).toBe(-192);
  });

  it('两侧按 side 分列，根和左右叠都在总高度里居中', () => {
    const boxes = layout(
      [point('R', null), point('A', 'R', 0, 168, 56, 'right'), point('C', 'R', 1, 168, 56, 'left')],
      { direction: 'both', anchors: anchor('R', 48, 48) },
    );
    expect(at(boxes, 'R')).toEqual({ id: 'R', x: 48, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: 288, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'C')).toEqual({ id: 'C', x: -192, y: 48, w: 168, h: 56 });
  });

  it('右侧再加一个同级时，左侧在更高的块里居中', () => {
    const boxes = layout(
      [
        point('R', null),
        point('A', 'R', 0, 168, 56, 'right'),
        point('D', 'R', 1, 168, 56, 'right'),
        point('C', 'R', 2, 168, 56, 'left'),
      ],
      { direction: 'both', anchors: anchor('R', 48, 48) },
    );
    expect(at(boxes, 'R')).toEqual({ id: 'R', x: 48, y: 84, w: 168, h: 56 });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: 288, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'D')).toEqual({ id: 'D', x: 288, y: 120, w: 168, h: 56 });
    expect(at(boxes, 'C')).toEqual({ id: 'C', x: -192, y: 84, w: 168, h: 56 });
  });

  it('对调 order 后仍在右侧，只是上下交换', () => {
    const boxes = layout(
      [
        point('R', null),
        point('A', 'R', 1, 168, 56, 'right'),
        point('D', 'R', 0, 168, 56, 'right'),
        point('C', 'R', 2, 168, 56, 'left'),
      ],
      { direction: 'both', anchors: anchor('R', 48, 48) },
    );
    expect(at(boxes, 'D')).toEqual({ id: 'D', x: 288, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: 288, y: 120, w: 168, h: 56 });
    expect(at(boxes, 'C')?.x).toBe(-192);
  });

  it('side 为 null 时放在右侧', () => {
    const boxes = layout(
      [point('R', null), point('A', 'R', 0, 168, 56, null), point('C', 'R', 1, 168, 56, 'left')],
      { direction: 'both', anchors: anchor('R', 48, 48) },
    );
    expect(at(boxes, 'A')?.x).toBe(288);
    expect(at(boxes, 'C')?.x).toBe(-192);
  });

  it('更深的点跟着父项那一侧，忽略自己的 side', () => {
    const boxes = layout(
      [
        point('R', null),
        point('A', 'R', 0, 168, 56, 'right'),
        point('E', 'A', 0, 168, 56, 'left'),
        point('C', 'R', 1, 168, 56, 'left'),
        point('F', 'C', 0, 168, 56, 'right'),
      ],
      { direction: 'both', anchors: anchor('R', 48, 48) },
    );
    expect(at(boxes, 'E')).toEqual({ id: 'E', x: 528, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'C')?.x).toBe(-192);
    expect(at(boxes, 'F')).toEqual({ id: 'F', x: -432, y: 48, w: 168, h: 56 });
  });

  it('可见子项按 order 再按 id', () => {
    const boxes = layout(
      [point('R', null), point('b', 'R', 1), point('a', 'R', 1), point('c', 'R', 0)],
      { anchors: anchor('R', 48, 48) },
    );
    expect(at(boxes, 'c')?.y).toBe(48);
    expect(at(boxes, 'a')?.y).toBe(48 + 56 + 16);
    expect(at(boxes, 'b')?.y).toBe(48 + 56 + 16 + 56 + 16);
  });

  it('折叠父项后子项不在结果里，父项按叶子尺寸', () => {
    const boxes = layout(
      [point('R', null), point('A', 'R', 0, 168, 56), point('B', 'A', 0, 168, 74)],
      { folded: new Set(['A']), anchors: anchor('R', 48, 48) },
    );
    expect(boxes.map((box) => box.id).sort()).toEqual(['A', 'R']);
    expect(at(boxes, 'R')).toEqual({ id: 'R', x: 48, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: 288, y: 48, w: 168, h: 56 });
  });

  it('折叠后后面的同级向上补位', () => {
    const nodes = [
      point('R', null),
      point('A', 'R', 0),
      point('B', 'R', 1),
      point('E', 'B', 0, 168, 400),
      point('C', 'R', 2),
    ];
    const folded = layout(nodes, { folded: new Set(['B']), anchors: anchor('R', 48, 48) });
    const open = layout(nodes, { anchors: anchor('R', 48, 48) });
    expect(folded.some((box) => box.id === 'E')).toBe(false);
    expect(at(folded, 'C')?.y).toBe(192);
    expect(at(folded, 'C')?.y ?? 0).toBeLessThan(at(open, 'C')?.y ?? 0);
  });

  it('两个无锚点的单点根，第二个在下沿加 rootGap', () => {
    const boxes = layout([point('a', null, 0), point('b', null, 1)]);
    expect(at(boxes, 'a')).toEqual({ id: 'a', x: 48, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'b')?.y).toBe(48 + 56 + 96);
    expect(at(boxes, 'b')?.x).toBe(48);
  });

  it('两个无锚点根的包围盒垂直分离，间距不少于 rootGap', () => {
    const boxes = layout([
      point('R1', null, 0),
      point('A1', 'R1', 0, 168, 56),
      point('B1', 'R1', 1, 168, 74),
      point('R2', null, 1),
      point('A2', 'R2', 0, 168, 56),
      point('B2', 'R2', 1, 168, 74),
    ]);
    const firstBottom = Math.max(
      (at(boxes, 'R1')?.y ?? 0) + (at(boxes, 'R1')?.h ?? 0),
      (at(boxes, 'A1')?.y ?? 0) + (at(boxes, 'A1')?.h ?? 0),
      (at(boxes, 'B1')?.y ?? 0) + (at(boxes, 'B1')?.h ?? 0),
    );
    const secondTop = Math.min(at(boxes, 'R2')?.y ?? 0, at(boxes, 'A2')?.y ?? 0, at(boxes, 'B2')?.y ?? 0);
    expect(secondTop - firstBottom).toBeGreaterThanOrEqual(MINDMAP_ROOT_GAP);
    expect(secondTop - firstBottom).toBe(MINDMAP_ROOT_GAP);
  });

  it('有锚点的根不被无锚点的堆叠挪走', () => {
    const boxes = layout(
      [point('S', null, 5), point('T', null, 1), point('U', null, 2)],
      { anchors: anchor('S', 300, 300) },
    );
    expect(at(boxes, 'S')).toEqual({ id: 'S', x: 300, y: 300, w: 168, h: 56 });
    expect(at(boxes, 'T')).toEqual({ id: 'T', x: 48, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'U')?.y).toBe(48 + 56 + 96);
  });

  it('无锚点的树和锚点包围盒相交时往下推，锚点不动', () => {
    const boxes = layout([point('S', null, 0), point('T', null, 1)], { anchors: anchor('S', 48, 48) });
    expect(at(boxes, 'S')).toEqual({ id: 'S', x: 48, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'T')).toEqual({ id: 'T', x: 48, y: 104, w: 168, h: 56 });
  });

  it('向左且没有锚点时，把这些树平移到 minX 等于 originX', () => {
    const boxes = layout([point('R', null), point('A', 'R')], { direction: 'left' });
    expect(at(boxes, 'A')).toEqual({ id: 'A', x: 48, y: 48, w: 168, h: 56 });
    expect(at(boxes, 'R')).toEqual({ id: 'R', x: 288, y: 48, w: 168, h: 56 });
  });

  it('向右时忽略 side', () => {
    const boxes = layout([point('R', null), point('C', 'R', 0, 168, 56, 'left')], {
      anchors: anchor('R', 48, 48),
    });
    expect(at(boxes, 'C')?.x).toBe(288);
  });

  it('调用 textNodeHeight 时更高的同级把下一项拉开', () => {
    const plain = textNodeHeight('');
    const described = textNodeHeight('有');
    expect(plain).toBe(56);
    expect(described).toBe(74);
    const boxes = layout(
      [point('R', null, 0, 168, plain), point('A', 'R', 0, 168, described), point('B', 'R', 1, 168, plain)],
      { anchors: anchor('R', 48, 48) },
    );
    expect((at(boxes, 'B')?.y ?? 0) - (at(boxes, 'A')?.y ?? 0)).toBe(described + MINDMAP_SIBLING_GAP);
  });

  it('更宽的图片把下一级的 left 推远', () => {
    const narrow = imageFrame(220, 1);
    const wide = imageFrame(440, 1);
    const childLeft = (parent: { w: number; h: number }) => {
      const boxes = layout(
        [point('P', null, 0, parent.w, parent.h), point('C', 'P', 0, narrow.w, narrow.h)],
        { anchors: anchor('P', MINDMAP_ORIGIN_X, MINDMAP_ORIGIN_Y) },
      );
      return at(boxes, 'C')?.x ?? 0;
    };
    expect(childLeft(wide)).toBe(MINDMAP_ORIGIN_X + wide.w + MINDMAP_LEVEL_GAP);
    expect(childLeft(narrow)).toBe(MINDMAP_ORIGIN_X + narrow.w + MINDMAP_LEVEL_GAP);
    expect(childLeft(wide)).toBeGreaterThan(childLeft(narrow));
  });

  it('parentId 不在这批 id 里时返回空数组', () => {
    expect(layout([point('R', null), point('A', 'missing')])).toEqual([]);
  });

  it('自指时返回空数组', () => {
    expect(layout([point('A', 'A')])).toEqual([]);
  });

  it('成环时返回空数组', () => {
    expect(layout([point('R', null), point('A', 'B'), point('B', 'A')])).toEqual([]);
  });

  it('宽或高不是有限正数时返回空数组', () => {
    expect(layout([point('R', null, 0, 0, 56)])).toEqual([]);
    expect(layout([point('R', null, 0, Number.NaN, 56)])).toEqual([]);
    expect(layout([point('R', null, 0, 168, Number.POSITIVE_INFINITY)])).toEqual([]);
    expect(layout([point('R', null), point('A', 'R', 0, 168, -1)])).toEqual([]);
  });

  it('重复 id 时返回空数组', () => {
    expect(layout([point('R', null), point('R', null, 1)])).toEqual([]);
  });

  it('不修改入参', () => {
    const nodes = [point('R', null), point('A', 'R', 0, 168, 56), point('B', 'R', 1, 168, 74)];
    const before = nodes.map((node) => ({ ...node }));
    const folded = new Set(['A']);
    const anchors = anchor('R', 48, 48);
    layout(nodes, { folded, anchors, direction: 'both' });
    expect(nodes).toEqual(before);
    expect([...folded]).toEqual(['A']);
    expect(anchors.get('R')).toEqual({ x: 48, y: 48 });
  });

  it('500 个点都有坐标，子项在父项右侧', () => {
    const nodes: MindmapNode[] = [];
    for (let index = 0; index < 500; index += 1) {
      nodes.push(point(String(index), index === 0 ? null : String(index - 1), 0, 10, 10));
    }
    const boxes = layout(nodes, { direction: 'right' satisfies MindmapDirection });
    expect(boxes).toHaveLength(500);
    const byId = new Map(boxes.map((box) => [box.id, box]));
    for (let index = 1; index < 500; index += 1) {
      const parent = byId.get(String(index - 1));
      const child = byId.get(String(index));
      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      expect(child?.x).toBe((parent?.x ?? 0) + (parent?.w ?? 0) + MINDMAP_LEVEL_GAP);
      expect(child?.x ?? 0).toBeGreaterThan(parent?.x ?? 0);
    }
  });
});

describe('separateFromObstacles', () => {
  it('没有障碍时返回盒子的副本', () => {
    const boxes = [{ id: 'a', x: 1, y: 2, w: 3, h: 4 }];
    const result = separateFromObstacles(boxes, []);
    expect(result).toEqual(boxes);
    expect(result).not.toBe(boxes);
    expect(result[0]).not.toBe(boxes[0]);
  });

  it('已经分开则不动', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }];
    expect(separateFromObstacles(boxes, [{ x: 100, y: 100, w: 10, h: 10 }])).toEqual(boxes);
  });

  it('边界相贴不算相交', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }];
    expect(separateFromObstacles(boxes, [{ x: 10, y: 0, w: 10, h: 10 }])).toEqual(boxes);
  });

  it('一块重叠时按较小正方向推开，间隙 24，并且不再相交', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, w: 100, h: 40 }];
    const obstacles = [{ x: 90, y: 0, w: 20, h: 10 }];
    const result = separateFromObstacles(boxes, obstacles);
    expect(result).toEqual([{ id: 'a', x: 0, y: 34, w: 100, h: 40 }]);
    const moved = result[0];
    const obstacle = obstacles[0];
    expect(moved && obstacle).toBeTruthy();
    if (!moved || !obstacle) return;
    const overlaps =
      moved.x < obstacle.x + obstacle.w &&
      moved.x + moved.w > obstacle.x &&
      moved.y < obstacle.y + obstacle.h &&
      moved.y + moved.h > obstacle.y;
    expect(overlaps).toBe(false);
    expect(moved.y - (obstacle.y + obstacle.h)).toBe(24);
  });

  it('两个方向相等时只向右推', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }];
    const result = separateFromObstacles(boxes, [{ x: 5, y: 5, w: 10, h: 10 }]);
    expect(result).toEqual([{ id: 'a', x: 39, y: 0, w: 10, h: 10 }]);
  });

  it('两块障碍时第二块也会被处理', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, w: 40, h: 20 }];
    const obstacles = [
      { x: 30, y: 0, w: 20, h: 80 },
      { x: 80, y: 0, w: 50, h: 30 },
    ];
    const result = separateFromObstacles(boxes, obstacles);
    expect(result).toEqual([{ id: 'a', x: 74, y: 54, w: 40, h: 20 }]);
    const moved = result[0];
    expect(moved).toBeDefined();
    if (!moved) return;
    for (const obstacle of obstacles) {
      const overlaps =
        moved.x < obstacle.x + obstacle.w &&
        moved.x + moved.w > obstacle.x &&
        moved.y < obstacle.y + obstacle.h &&
        moved.y + moved.h > obstacle.y;
      expect(overlaps).toBe(false);
    }
  });

  it('轮数用尽仍相交时返回最后位置而不是抛错', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, w: 20, h: 20 }];
    const obstacles = [
      { x: 0, y: 0, w: 40, h: 40 },
      { x: 50, y: 0, w: 40, h: 40 },
      { x: 100, y: 0, w: 40, h: 40 },
    ];
    const result = separateFromObstacles(boxes, obstacles);
    expect(result).toEqual([{ id: 'a', x: 164, y: 0, w: 20, h: 20 }]);
  });

  it('不修改入参', () => {
    const boxes = [{ id: 'a', x: 0, y: 0, w: 10, h: 10 }];
    const obstacles = [{ x: 0, y: 0, w: 5, h: 5 }];
    const boxesBefore = boxes.map((box) => ({ ...box }));
    const obstaclesBefore = obstacles.map((item) => ({ ...item }));
    separateFromObstacles(boxes, obstacles);
    expect(boxes).toEqual(boxesBefore);
    expect(obstacles).toEqual(obstaclesBefore);
  });
});
