import { describe, expect, it } from 'vitest';
import { layoutBoard } from './board-layout.js';

describe('layoutBoard', () => {
  it('没有节点时是空的', () => {
    expect(layoutBoard([], [])).toEqual([]);
  });

  it('没有边时横排', () => {
    const boxes = layoutBoard([{ id: 'a' }, { id: 'b' }], []);
    expect(boxes.map((box) => box.id)).toEqual(['a', 'b']);
    expect(boxes[0]?.y).toBe(boxes[1]?.y);
    expect(boxes[0]?.x).toBeLessThan(boxes[1]?.x ?? 0);
  });

  it('一条边时源在目标左边', () => {
    const boxes = layoutBoard(
      [{ id: 'b' }, { id: 'a' }],
      [{ fromId: 'a', toId: 'b' }],
    );
    const source = boxes.find((box) => box.id === 'a');
    const target = boxes.find((box) => box.id === 'b');
    expect(source && target && source.x < target.x).toBe(true);
  });

  it('成环时退回横排，每个点都在', () => {
    const boxes = layoutBoard(
      [{ id: 'a' }, { id: 'b' }],
      [
        { fromId: 'a', toId: 'b' },
        { fromId: 'b', toId: 'a' },
      ],
    );
    expect(boxes.map((box) => box.id)).toEqual(['a', 'b']);
    expect(boxes[0]?.y).toBe(boxes[1]?.y);
    expect(boxes[0]?.x).toBeLessThan(boxes[1]?.x ?? 0);
  });
});
