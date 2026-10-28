import { describe, expect, it } from 'vitest';
import { arrowPath, edgeDraw, edgeGeometry, edgeLanes, edgeMidpoint } from './edge-geometry.js';

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

describe('edgeDraw', () => {
  it('接近水平或垂直时曲线退成直线', () => {
    const flat = edgeDraw(from, to, 0, 1, false, 'curve');
    const line = edgeDraw(from, to, 0, 1, false, 'straight');
    expect(flat.d).toBe(line.d);
    expect(flat.label).toEqual(line.label);

    const down = { x: 32, y: 220, w: 168, h: 56 };
    const vertical = edgeDraw(from, down, 0, 1, false, 'curve');
    expect(vertical.d.includes(' C ')).toBe(false);
    expect(vertical.labelOut.y).toBeCloseTo(0);
    expect(Math.abs(vertical.labelOut.x)).toBeCloseTo(1);
  });

  it('斜向曲线在中段平滑弯出，标签落在弦的中点', () => {
    const diag = { x: 280, y: 240, w: 168, h: 56 };
    const curve = edgeDraw(from, diag, 0, 1, false, 'curve');
    const ends = edgeGeometry(from, diag, 0, 1, false);
    const dx = ends.x2 - ends.x1;
    const dy = ends.y2 - ends.y1;
    const along = ((curve.label.x - ends.x1) * dx + (curve.label.y - ends.y1) * dy) / (dx * dx + dy * dy);
    const lx = curve.label.x - (ends.x1 + ends.x2) / 2;
    const ly = curve.label.y - (ends.y1 + ends.y2) / 2;
    expect(curve.d.includes(' C ')).toBe(true);
    expect(along).toBeCloseTo(0.5, 2);
    expect(Math.hypot(lx, ly)).toBeGreaterThan(8);
    expect(lx * dx + ly * dy).toBeCloseTo(0, 0);

    const controls = curve.d.match(/C ([\d.-]+) ([\d.-]+)/);
    expect(controls).not.toBeNull();
    const c1x = Number(controls?.[1]);
    const c1y = Number(controls?.[2]);
    const handle = Math.hypot(c1x - ends.x1, c1y - ends.y1);
    const parallel = ((c1x - ends.x1) * dx + (c1y - ends.y1) * dy) / Math.hypot(dx, dy);
    const cross = Math.abs((c1x - ends.x1) * dy - (c1y - ends.y1) * dx) / Math.hypot(dx, dy);
    expect(parallel / handle).toBeGreaterThan(Math.cos((24 * Math.PI) / 180));
    expect(cross / handle).toBeLessThan(Math.sin((24 * Math.PI) / 180));
  });

  it('左右并排时折线从右边框接到左边框，两条边错开', () => {
    const a = edgeDraw(from, to, 0, 2, false, 'orthogonal');
    const b = edgeDraw(from, to, 1, 2, false, 'orthogonal');
    expect(a.d.startsWith(`M ${from.x + from.w} `)).toBe(true);
    expect(a.d.endsWith(` ${to.x}`)).toBe(false);
    expect(a.d.includes(`L ${to.x} `) || a.d.endsWith(String(to.x))).toBe(true);
    expect(a.label.y).not.toBe(b.label.y);
    expect(a.d.includes(' Q ')).toBe(true);
  });

  it('有箭头时线停在箭头底部，尖端仍在终点边框，标签不跟着缩短', () => {
    const plain = edgeDraw(from, to, 0, 1, false, 'straight');
    const drawn = edgeDraw(from, to, 0, 1, false, 'straight', 8);
    expect(drawn.tip).toEqual({ x: to.x, y: centerY, ux: 1, uy: 0 });
    expect(drawn.d).toBe(`M ${from.x + from.w} ${centerY} L ${to.x - 8} ${centerY}`);
    expect(drawn.label).toEqual(plain.label);
    expect(drawn.labelOut.y).toBeCloseTo(-1);
    expect(arrowPath(drawn.tip)).toBe(`M ${to.x} ${centerY} L ${to.x - 8} ${centerY + 3.5} L ${to.x - 8} ${centerY - 3.5} Z`);

    const elbow = edgeDraw(from, to, 0, 1, false, 'orthogonal', 8);
    const elbowPlain = edgeDraw(from, to, 0, 1, false, 'orthogonal');
    expect(elbow.tip.x).toBe(to.x);
    expect(elbow.label).toEqual(elbowPlain.label);
    expect(elbow.d.includes(String(to.x))).toBe(false);
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
