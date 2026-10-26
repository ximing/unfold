import { describe, expect, it } from 'vitest';
import { applyPanelWidth, readPanelWidth } from './panel-width.js';

describe('readPanelWidth', () => {
  it('空值和非法值用 640', () => {
    expect(readPanelWidth(null)).toBe(640);
    expect(readPanelWidth('')).toBe(640);
    expect(readPanelWidth('479')).toBe(640);
    expect(readPanelWidth('881')).toBe(640);
    expect(readPanelWidth('abc')).toBe(640);
  });

  it('闭区间内的有限数保留，含 640.5', () => {
    expect(readPanelWidth('640')).toBe(640);
    expect(readPanelWidth('480')).toBe(480);
    expect(readPanelWidth('880')).toBe(880);
    expect(readPanelWidth('640.5')).toBe(640.5);
  });
});

describe('applyPanelWidth', () => {
  it('按框架宽度给画布留 320', () => {
    expect(applyPanelWidth(640, 2000)).toBe(640);
    expect(applyPanelWidth(640, 900)).toBe(580);
    expect(applyPanelWidth(640, 700)).toBe(380);
    expect(applyPanelWidth(640, 0)).toBe(640);
  });
});
