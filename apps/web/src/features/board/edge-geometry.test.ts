import { describe, expect, it } from 'vitest';
import { edgeGeometry, edgeLanes, edgeMidpoint } from './edge-geometry.js';

const from = { x: 32, y: 48, w: 168, h: 56 };
const to = { x: 252, y: 48, w: 168, h: 56 };
const centerY = 48 + 56 / 2;

describe('edgeGeometry', () => {
  it('左右并排、同一水平线、只有一条边时贴在边框中心', () => {
    const seg = edgeGeometry(from, to, 0, 1, false);
    expect(seg.x1).toBe(from.x + from.w);
    expect(seg.x2).toBe(to.x);
    expect(seg.y1).toBe(centerY);
    expect(seg.y2).toBe(centerY);
  });

  it('同一方向两条边在法线方向错开，且不在同一条线上', () => {
    const a = edgeGeometry(from, to, 0, 2, false);
    const b = edgeGeometry(from, to, 1, 2, false);
    expect(a.x1).toBe(from.x + from.w);
    expect(b.x1).toBe(from.x + from.w);
    expect(a.x2).toBe(to.x);
    expect(b.x2).toBe(to.x);
    expect(a.y1).not.toBe(b.y1);
    expect(a.y2).not.toBe(b.y2);
    expect(Math.abs(a.y1 - b.y1)).toBe(16);
    expect(Math.abs(a.y2 - b.y2)).toBe(16);
  });

  it('相反方向的偏移符号相反', () => {
    const forward = edgeGeometry(from, to, 0, 1, true);
    const backward = edgeGeometry(to, from, 0, 1, true);
    const forwardShift = edgeMidpoint(forward).y - centerY;
    const backwardShift = edgeMidpoint(backward).y - centerY;
    expect(forwardShift).not.toBe(0);
    expect(backwardShift).not.toBe(0);
    expect(Math.sign(forwardShift)).toBe(-Math.sign(backwardShift));
    expect(Math.abs(forwardShift - backwardShift)).toBe(16);
  });

  it('中点是两端的平均', () => {
    const seg = edgeGeometry(from, to, 1, 2, false);
    const mid = edgeMidpoint(seg);
    expect(mid.x).toBe((seg.x1 + seg.x2) / 2);
    expect(mid.y).toBe((seg.y1 + seg.y2) / 2);
  });
});

describe('edgeLanes', () => {
  it('按边 id 的字典序编号，反向另侧成对', () => {
    const lanes = edgeLanes([
      { id: 'm', fromId: 'a', toId: 'b' },
      { id: 'a', fromId: 'a', toId: 'b' },
      { id: 'z', fromId: 'b', toId: 'a' },
    ]);
    expect(lanes.get('a')).toEqual({ index: 0, count: 2, paired: true });
    expect(lanes.get('m')).toEqual({ index: 1, count: 2, paired: true });
    expect(lanes.get('z')).toEqual({ index: 0, count: 1, paired: true });
  });
});
