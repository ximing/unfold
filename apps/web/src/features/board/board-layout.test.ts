import { describe, expect, it } from 'vitest';
import { NODE_H, NODE_W, layoutBoard, layoutPlaced, placeNewCorners, textNodeHeight } from './board-layout.js';

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

describe('textNodeHeight', () => {
  it('空描述保持 56，有描述时为 74', () => {
    expect(textNodeHeight('')).toBe(56);
    expect(textNodeHeight('  ')).toBe(56);
    expect(textNodeHeight(undefined)).toBe(56);
    expect(textNodeHeight(null)).toBe(56);
    expect(textNodeHeight('一句')).toBe(74);
  });
});

describe('layoutPlaced', () => {
  it('全部未放置时结果与 layoutBoard 一致', () => {
    const items = [
      { id: 'b', x: null, y: null },
      { id: 'a', x: null, y: null },
    ];
    const links = [{ fromId: 'a', toId: 'b' }];
    expect(layoutPlaced(items, links, { x: 800, y: 800 })).toEqual(layoutBoard(items, links));
  });

  it('已有 x 的点坐标不被自动布局改掉', () => {
    const items = [
      { id: 'a', x: 480, y: 12 },
      { id: 'b', x: null, y: null },
    ];
    const links = [{ fromId: 'a', toId: 'b' }];
    const laid = layoutBoard(items, links);
    const boxes = layoutPlaced(items, links, { x: 900, y: 40 });
    const saved = boxes.find((box) => box.id === 'a');
    const fresh = boxes.find((box) => box.id === 'b');
    const laidSaved = laid.find((box) => box.id === 'a');
    expect(laidSaved?.x).not.toBe(480);
    expect(saved).toMatchObject({ x: 480, y: 12, w: laidSaved?.w, h: laidSaved?.h });
    expect(fresh).toMatchObject({ x: 900, y: 40, w: laidSaved?.w, h: laidSaved?.h });
  });

  it('全部已有坐标时保留输入顺序和坐标', () => {
    const items = [
      { id: 'b', x: 10, y: 20 },
      { id: 'a', x: 400, y: null },
    ];
    const boxes = layoutPlaced(items, [{ fromId: 'a', toId: 'b' }], { x: 0, y: 0 });
    expect(boxes.map((box) => box.id)).toEqual(['b', 'a']);
    expect(boxes[0]).toEqual({ id: 'b', x: 10, y: 20, w: NODE_W, h: NODE_H });
    expect(boxes[1]).toEqual({ id: 'a', x: 400, y: 0, w: NODE_W, h: NODE_H });
  });

  it('未放置的点从给定中心向右下按 24 让开左上角', () => {
    expect(placeNewCorners(1, { x: 10, y: 20 }, [])).toEqual([{ x: 10, y: 20 }]);
    expect(placeNewCorners(1, { x: 0, y: 0 }, [{ x: 0.9, y: 0 }])).toEqual([{ x: 24, y: 24 }]);
    expect(placeNewCorners(1, { x: 0, y: 0 }, [{ x: 1, y: 0 }])).toEqual([{ x: 0, y: 0 }]);
    const items = [
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: null, y: null },
      { id: 'c', x: null, y: null },
    ];
    const boxes = layoutPlaced(items, [], { x: 10, y: 20 });
    expect(boxes.find((box) => box.id === 'a')).toMatchObject({ x: 10, y: 20 });
    expect(boxes.find((box) => box.id === 'b')).toMatchObject({ x: 34, y: 44 });
    expect(boxes.find((box) => box.id === 'c')).toMatchObject({ x: 58, y: 68 });
  });
});
