import { describe, expect, it } from 'vitest';
import { richImageDisplayWidth, richImageWidthCommit } from './rich-image-size.js';

describe('richImageDisplayWidth', () => {
  it('按拖动距离取整', () => {
    expect(richImageDisplayWidth(200, 10.4, 800)).toBe(210);
    expect(richImageDisplayWidth(200.6, 0, 800)).toBe(201);
  });

  it('不小于 32，不大于 1200，也不超过所在区域', () => {
    expect(richImageDisplayWidth(40, -100, 800)).toBe(32);
    expect(richImageDisplayWidth(200, 2000, 800)).toBe(800);
    expect(richImageDisplayWidth(200, 2000, 2000)).toBe(1200);
    expect(richImageDisplayWidth(10, 0, 20)).toBe(32);
  });

  it('非法位移按没拖动，非法区域按 1200', () => {
    expect(richImageDisplayWidth(200, Number.NaN, 800)).toBe(200);
    expect(richImageDisplayWidth(200, 10, Number.NaN)).toBe(210);
    expect(richImageDisplayWidth(Number.NaN, 10, 800)).toBe(42);
  });

  it('按画面缩放把指针位移换回 CSS 像素', () => {
    expect(richImageDisplayWidth(200, 98, 800, 0.98)).toBe(300);
    expect(richImageDisplayWidth(200, 10, 800, 0)).toBe(210);
  });
});

describe('richImageWidthCommit', () => {
  it('画面没变，或指针几乎没动，不写入', () => {
    expect(richImageWidthCommit(500.2, 0, 500)).toBeNull();
    expect(richImageWidthCommit(500.2, 0.4, 501)).toBeNull();
    expect(richImageWidthCommit(Number.NaN, 20, 80)).toBeNull();
  });

  it('已经顶到区域边缘时，往外拖不把更大的已存宽度改小', () => {
    const start = 500.4;
    const delta = 40;
    const next = richImageDisplayWidth(start, delta, start);
    expect(next).toBe(500);
    expect(richImageWidthCommit(start, delta, next)).toBeNull();
  });

  it('从区域边缘往里拖，记下新的画面宽度', () => {
    const start = 500.4;
    const delta = -40;
    const next = richImageDisplayWidth(start, delta, start);
    expect(next).toBe(460);
    expect(richImageWidthCommit(start, delta, next)).toBe(460);
  });
});
