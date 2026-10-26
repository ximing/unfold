import { describe, expect, it } from 'vitest';
import { IMAGE_NAME_LINE, imageFrame } from './image-frame.js';

describe('imageFrame', () => {
  it('缺省宽是 220', () => {
    expect(imageFrame(null, 1).w).toBe(220);
    expect(imageFrame(undefined, 1).w).toBe(220);
  });

  it('10 夹到 120', () => {
    expect(imageFrame(10, 1).w).toBe(120);
  });

  it('900 夹到 480', () => {
    expect(imageFrame(900, 1).w).toBe(480);
  });

  it('300 且 ratio 2 时图片高 150、总高 172', () => {
    expect(IMAGE_NAME_LINE).toBe(22);
    expect(imageFrame(300, 2)).toEqual({ w: 300, pictureH: 150, h: 172 });
  });

  it('ratio 为 0 或 NaN 时按 1', () => {
    expect(imageFrame(300, 0)).toEqual(imageFrame(300, 1));
    expect(imageFrame(300, Number.NaN)).toEqual(imageFrame(300, 1));
  });
});
