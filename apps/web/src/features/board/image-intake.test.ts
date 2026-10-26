import { describe, expect, it } from 'vitest';
import {
  IMAGE_FORMAT_MESSAGE,
  IMAGE_SIZE_MESSAGE,
  MAX_IMAGE_BYTES,
  imageDropSpots,
  imageFileIssue,
} from './image-intake.js';

describe('imageFileIssue', () => {
  it('刚好 10 MB 可以通过', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(imageFileIssue({ type: 'image/png', size: MAX_IMAGE_BYTES })).toBeNull();
  });

  it('超过 10 MB 用大小那句，不管类型', () => {
    expect(imageFileIssue({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toBe(IMAGE_SIZE_MESSAGE);
    expect(imageFileIssue({ type: 'application/pdf', size: MAX_IMAGE_BYTES + 1 })).toBe(IMAGE_SIZE_MESSAGE);
    expect(imageFileIssue({ type: '', size: MAX_IMAGE_BYTES + 1 })).toBe(IMAGE_SIZE_MESSAGE);
  });

  it('jpeg、jpg、png、webp、gif 合法，参数和大小写忽略', () => {
    expect(imageFileIssue({ type: 'image/jpeg', size: 10 })).toBeNull();
    expect(imageFileIssue({ type: 'image/jpg', size: 10 })).toBeNull();
    expect(imageFileIssue({ type: 'image/png', size: 10 })).toBeNull();
    expect(imageFileIssue({ type: 'image/webp', size: 10 })).toBeNull();
    expect(imageFileIssue({ type: 'image/gif', size: 10 })).toBeNull();
    expect(imageFileIssue({ type: 'IMAGE/JPEG; charset=binary', size: 10 })).toBeNull();
    expect(imageFileIssue({ type: 'image/png;charset=utf-8', size: 10 })).toBeNull();
  });

  it('空类型交给服务端', () => {
    expect(imageFileIssue({ type: '', size: 10 })).toBeNull();
    expect(imageFileIssue({ type: '  ; charset=binary', size: 10 })).toBeNull();
  });

  it('pdf、svg、heic、text 用格式那句', () => {
    expect(IMAGE_FORMAT_MESSAGE).toBe('只能放入 JPEG、PNG、WebP 或 GIF');
    expect(IMAGE_SIZE_MESSAGE).toBe('图片不能超过 10 MB');
    expect(imageFileIssue({ type: 'application/pdf', size: 10 })).toBe(IMAGE_FORMAT_MESSAGE);
    expect(imageFileIssue({ type: 'image/svg+xml', size: 10 })).toBe(IMAGE_FORMAT_MESSAGE);
    expect(imageFileIssue({ type: 'image/heic', size: 10 })).toBe(IMAGE_FORMAT_MESSAGE);
    expect(imageFileIssue({ type: 'text/plain', size: 10 })).toBe(IMAGE_FORMAT_MESSAGE);
  });
});

describe('imageDropSpots', () => {
  it('少于一张时是空的', () => {
    expect(imageDropSpots('corner', { x: 0, y: 0 }, 0, [])).toEqual([]);
    expect(imageDropSpots('center', { x: 200, y: 200 }, -1, [])).toEqual([]);
  });

  it('corner 两张、空 occupied 从原点向右下错开', () => {
    expect(imageDropSpots('corner', { x: 0, y: 0 }, 2, [])).toEqual([
      { x: 0, y: 0 },
      { x: 24, y: 24 },
    ]);
  });

  it('center 一张落在视野中心对应的左上角', () => {
    expect(imageDropSpots('center', { x: 200, y: 200 }, 1, [])).toEqual([{ x: 90, y: 79 }]);
  });
});
