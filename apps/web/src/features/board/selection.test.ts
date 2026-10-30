import { describe, expect, it } from 'vitest';
import {
  applyMarquee,
  applyPick,
  moveDelta,
  nodesInRect,
  normalizeRect,
  pickModeFromKeys,
  stackOrder,
} from './selection.js';

const nodes = [
  { id: 'a', x: 0, y: 0, w: 40, h: 20 },
  { id: 'b', x: 100, y: 0, w: 40, h: 20 },
  { id: 'c', x: 0, y: 80, w: 40, h: 20 },
];

describe('selection', () => {
  it('从任意角拉出的矩形都归一到左上角', () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, w: 20, h: 35 });
  });

  it('框住相交的点，擦边不算，一条横线可以切开点', () => {
    expect(nodesInRect(nodes, { x: 20, y: 10, w: 100, h: 5 })).toEqual(['a', 'b']);
    expect(nodesInRect(nodes, { x: 40, y: 0, w: 10, h: 20 })).toEqual([]);
    expect(nodesInRect(nodes, { x: 10, y: 10, w: 20, h: 0 })).toEqual(['a']);
    expect(nodesInRect(nodes, { x: 10, y: 10, w: 0, h: 0 })).toEqual([]);
  });

  it('点选替换，Shift 加选，⌘ 切换', () => {
    expect(pickModeFromKeys({ metaKey: true, ctrlKey: false, shiftKey: true })).toBe('toggle');
    expect(pickModeFromKeys({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe('toggle');
    expect(pickModeFromKeys({ metaKey: false, ctrlKey: false, shiftKey: true })).toBe('add');
    expect(applyPick(['a'], 'b', 'replace')).toEqual(['b']);
    expect(applyPick(['a'], 'a', 'add')).toEqual(['a']);
    expect(applyPick(['a'], 'b', 'add')).toEqual(['a', 'b']);
    expect(applyPick(['a', 'b'], 'b', 'toggle')).toEqual(['a']);
    expect(applyPick(['a'], 'b', 'toggle')).toEqual(['a', 'b']);
  });

  it('普通框选替换，加选只补新的，框空则清掉', () => {
    expect(applyMarquee(['c'], ['a', 'b'], false)).toEqual(['a', 'b']);
    expect(applyMarquee(['c'], [], false)).toEqual([]);
    expect(applyMarquee(['a', 'c'], ['a', 'b'], true)).toEqual(['a', 'c', 'b']);
    expect(applyMarquee(['a'], [], true)).toEqual(['a']);
  });

  it('整组共用被抓住的点贴格后的位移', () => {
    expect(moveDelta({ x: 10, y: 20 }, { x: 0, y: 0 }, { x: 9, y: 7 }, false)).toEqual({ dx: 9, dy: 7 });
    expect(moveDelta({ x: 10, y: 20 }, { x: 0, y: 0 }, { x: 9, y: 7 }, true)).toEqual({ dx: 6, dy: 12 });
  });

  it('被抓住的点排到最后', () => {
    expect(stackOrder(['a', 'b', 'c'], 'b')).toEqual(['a', 'c', 'b']);
    expect(stackOrder(['a'], 'missing')).toEqual(['a']);
  });
});
