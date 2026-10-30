import { describe, expect, it } from 'vitest';
import {
  hasOutlineCycle,
  indent,
  initialRoots,
  moveSibling,
  normalizeOutline,
  outdent,
  promoteOnRemove,
  type OutlineItem,
} from './index.js';

function item(nodeId: string, parentId: string | null, order: number): OutlineItem {
  return { nodeId, parentId, order };
}

function view(items: readonly OutlineItem[]): OutlineItem[] {
  return [...items].sort((a, b) => {
    const parent = (a.parentId ?? '').localeCompare(b.parentId ?? '');
    if (parent !== 0) return parent;
    return a.order - b.order || a.nodeId.localeCompare(b.nodeId);
  });
}

const tree = [
  item('A', null, 0),
  item('B', null, 1),
  item('C', null, 2),
  item('B1', 'B', 0),
  item('B2', 'B', 1),
  item('B1a', 'B1', 0),
];

describe('initialRoots', () => {
  it('orders by createdAt then node id and ignores coordinates', () => {
    expect(
      initialRoots([
        { nodeId: 'b', createdAt: '2020-01-02T00:00:00.000Z' },
        { nodeId: 'c', createdAt: '2020-01-02T00:00:00.000Z' },
        { nodeId: 'a', createdAt: '2020-01-01T00:00:00.000Z' },
      ]),
    ).toEqual([item('a', null, 0), item('b', null, 1), item('c', null, 2)]);
  });
});

describe('normalizeOutline', () => {
  it('compacts gaps and breaks ties by node id', () => {
    expect(view(normalizeOutline([item('b', null, 5), item('a', null, 5), item('c', 'a', 4)]))).toEqual([
      item('a', null, 0),
      item('b', null, 1),
      item('c', 'a', 0),
    ]);
  });
});

describe('indent', () => {
  it('hangs the node under the previous sibling and keeps descendants', () => {
    expect(view(indent(tree, 'B'))).toEqual(
      view([
        item('A', null, 0),
        item('C', null, 1),
        item('B', 'A', 0),
        item('B1', 'B', 0),
        item('B2', 'B', 1),
        item('B1a', 'B1', 0),
      ]),
    );
  });

  it('appends after existing children of the previous sibling', () => {
    const items = [item('A', null, 0), item('A1', 'A', 0), item('B', null, 1)];
    expect(view(indent(items, 'B'))).toEqual(view([item('A', null, 0), item('A1', 'A', 0), item('B', 'A', 1)]));
  });

  it('returns the same tree when there is no previous sibling', () => {
    expect(view(indent(tree, 'A'))).toEqual(view(tree));
    expect(view(indent(tree, 'B1'))).toEqual(view(tree));
    expect(view(indent(tree, 'missing'))).toEqual(view(tree));
  });
});

describe('outdent', () => {
  it('places the node just after its parent and keeps descendants', () => {
    expect(view(outdent(tree, 'B1'))).toEqual(
      view([
        item('A', null, 0),
        item('B', null, 1),
        item('B1', null, 2),
        item('C', null, 3),
        item('B2', 'B', 0),
        item('B1a', 'B1', 0),
      ]),
    );
  });

  it('moves under the grandparent and shifts later siblings', () => {
    const items = [
      item('A', null, 0),
      item('B', 'A', 0),
      item('C', 'A', 1),
      item('C1', 'C', 0),
      item('D', 'A', 2),
    ];
    expect(view(outdent(items, 'C1'))).toEqual(
      view([
        item('A', null, 0),
        item('B', 'A', 0),
        item('C', 'A', 1),
        item('C1', 'A', 2),
        item('D', 'A', 3),
      ]),
    );
  });

  it('leaves a root unchanged', () => {
    expect(view(outdent(tree, 'A'))).toEqual(view(tree));
    expect(view(outdent(tree, 'missing'))).toEqual(view(tree));
  });
});

describe('moveSibling', () => {
  it('swaps with the next or previous sibling only', () => {
    expect(view(moveSibling(tree, 'B', 'down'))).toEqual(
      view([
        item('A', null, 0),
        item('C', null, 1),
        item('B', null, 2),
        item('B1', 'B', 0),
        item('B2', 'B', 1),
        item('B1a', 'B1', 0),
      ]),
    );
    expect(view(moveSibling(tree, 'B', 'up'))).toEqual(
      view([
        item('B', null, 0),
        item('A', null, 1),
        item('C', null, 2),
        item('B1', 'B', 0),
        item('B2', 'B', 1),
        item('B1a', 'B1', 0),
      ]),
    );
  });

  it('stays put at the ends', () => {
    expect(view(moveSibling(tree, 'A', 'up'))).toEqual(view(tree));
    expect(view(moveSibling(tree, 'C', 'down'))).toEqual(view(tree));
    expect(view(moveSibling(tree, 'B1', 'up'))).toEqual(view(tree));
    expect(view(moveSibling(tree, 'B2', 'down'))).toEqual(view(tree));
  });
});

describe('promoteOnRemove', () => {
  it('fills the removed slot with its direct children, in their order', () => {
    expect(view(promoteOnRemove(tree, 'B'))).toEqual(
      view([
        item('A', null, 0),
        item('B1', null, 1),
        item('B2', null, 2),
        item('C', null, 3),
        item('B1a', 'B1', 0),
      ]),
    );
  });

  it('closes the gap when the removed node has no children', () => {
    expect(view(promoteOnRemove(tree, 'A'))).toEqual(
      view([
        item('B', null, 0),
        item('C', null, 1),
        item('B1', 'B', 0),
        item('B2', 'B', 1),
        item('B1a', 'B1', 0),
      ]),
    );
  });

  it('returns the same tree when the node is absent', () => {
    expect(view(promoteOnRemove(tree, 'missing'))).toEqual(view(tree));
  });
});

describe('hasOutlineCycle', () => {
  it('detects a loop and a self parent', () => {
    expect(hasOutlineCycle([item('A', 'B', 0), item('B', 'A', 0)])).toBe(true);
    expect(hasOutlineCycle([item('A', 'A', 0)])).toBe(true);
    expect(hasOutlineCycle([item('A', 'B', 0), item('B', 'C', 0), item('C', 'A', 0)])).toBe(true);
  });

  it('ignores a parent that is not in the set', () => {
    expect(hasOutlineCycle(tree)).toBe(false);
    expect(hasOutlineCycle([item('A', 'missing', 0)])).toBe(false);
    expect(hasOutlineCycle([])).toBe(false);
  });
});
