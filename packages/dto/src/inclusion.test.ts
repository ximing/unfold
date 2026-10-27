import { describe, expect, it } from 'vitest';
import { createInclusionBodySchema } from './graph.js';
import { INCLUSION_PAD, INCLUSION_TITLE, anchorForFrameOrigin } from './inclusion.js';

describe('anchorForFrameOrigin', () => {
  it('没有已摆放的点时，锚点就是边框左上角', () => {
    expect(anchorForFrameOrigin({ x: 40, y: 50 }, [{ x: null, y: null }])).toEqual({ x: 40, y: 50 });
  });

  it('让最小坐标落在边框内边距处', () => {
    expect(anchorForFrameOrigin({ x: 0, y: 0 }, [{ x: 10, y: 30 }, { x: 80, y: null }])).toEqual({
      x: INCLUSION_PAD - 10,
      y: INCLUSION_PAD + INCLUSION_TITLE - 30,
    });
  });
});

describe('createInclusionBodySchema', () => {
  const childId = '550e8400-e29b-41d4-a716-446655440000';

  it('标签可以不写，写了就不能是空白', () => {
    expect(createInclusionBodySchema.parse({ childId, originX: 1, originY: 2 }).label).toBeUndefined();
    const blank = createInclusionBodySchema.safeParse({ childId, originX: 1, originY: 2, label: '  ' });
    expect(blank.success).toBe(false);
    if (!blank.success) {
      expect(blank.error.issues.some((issue) => issue.message === '关系说明不能是空的')).toBe(true);
    }
  });
});
