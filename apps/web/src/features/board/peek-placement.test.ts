import { describe, expect, it } from 'vitest';
import { peekPlacement } from './peek-placement.js';

const host = { hostWidth: 800, hostHeight: 600, cardWidth: 240, cardHeight: 80 };

describe('peekPlacement', () => {
  it('右侧放得下就贴在点的右边', () => {
    const place = peekPlacement({ ...host, nodeLeft: 100, nodeTop: 120, nodeRight: 268, nodeBottom: 176 });
    expect(place).toEqual({ flip: false, left: 280, top: 120 });
  });

  it('右侧不够就放到左边', () => {
    const place = peekPlacement({ ...host, nodeLeft: 500, nodeTop: 120, nodeRight: 668, nodeBottom: 176 });
    expect(place).toEqual({ flip: true, left: 248, top: 120 });
  });

  it('靠近视口下沿时整张预览上移', () => {
    const place = peekPlacement({ ...host, nodeLeft: 100, nodeTop: 560, nodeRight: 268, nodeBottom: 616 });
    expect(place.top).toBe(512);
    expect(place.flip).toBe(false);
  });

  it('两边都挤时仍留在视口内', () => {
    const place = peekPlacement({ ...host, nodeLeft: 20, nodeTop: 40, nodeRight: 780, nodeBottom: 96 });
    expect(place.flip).toBe(false);
    expect(place.left).toBe(552);
    expect(place.top).toBe(40);
  });
});
