import { describe, expect, it } from 'vitest';
import { snapPoint, snapTextOrigin, snapToGrid } from './snap.js';

describe('snap', () => {
  it('贴到 16 的倍数', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(7)).toBe(0);
    expect(snapToGrid(8)).toBe(16);
    expect(snapToGrid(-20)).toBe(-16);
    expect(snapToGrid(-9)).toBe(-16);
  });

  it('关掉时保留原坐标', () => {
    expect(snapPoint({ x: 3, y: 9 }, false)).toEqual({ x: 3, y: 9 });
  });

  it('文字点按左上角贴格，点击位置跟着平移', () => {
    const at = snapTextOrigin({ x: 100, y: 50 }, true);
    expect(at.x - 84).toBe(16);
    expect(at.y - 28).toBe(16);
    expect(snapTextOrigin({ x: 100, y: 50 }, false)).toEqual({ x: 100, y: 50 });
  });
});
