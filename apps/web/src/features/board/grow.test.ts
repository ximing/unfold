import { describe, expect, it } from 'vitest';
import { GAP_X, GAP_Y, NODE_H, NODE_W } from './board-layout.js';
import { GROW_CHILD_LABEL, GROW_SIBLING_BLOCKED, planGrow } from './grow.js';

const anchor = { x: 32, y: 48, w: NODE_W, h: NODE_H };

describe('planGrow', () => {
  it('下级的占位标签是下一级', () => {
    expect(GROW_CHILD_LABEL).toBe('下一级');
  });

  it('下级默认放在下方，边从选中点指出', () => {
    const plan = planGrow('child', 'a', [], anchor, [anchor]);
    expect(plan).toEqual({ ok: true, fromId: 'a', x: anchor.x, y: anchor.y + anchor.h + GAP_Y });
  });

  it('下级方向可以改成上、左、右', () => {
    expect(planGrow('child', 'a', [], anchor, [anchor], 'up')).toEqual({
      ok: true,
      fromId: 'a',
      x: anchor.x,
      y: anchor.y - NODE_H - GAP_Y,
    });
    expect(planGrow('child', 'a', [], anchor, [anchor], 'left')).toEqual({
      ok: true,
      fromId: 'a',
      x: anchor.x - NODE_W - GAP_X,
      y: anchor.y,
    });
    expect(planGrow('child', 'a', [], anchor, [anchor], 'right')).toEqual({
      ok: true,
      fromId: 'a',
      x: anchor.x + anchor.w + GAP_X,
      y: anchor.y,
    });
  });

  it('左右被挡住时向下让，上下被挡住时向右让', () => {
    const rightSlot = { x: anchor.x + anchor.w + GAP_X, y: anchor.y, w: NODE_W, h: NODE_H };
    expect(planGrow('child', 'a', [], anchor, [anchor, rightSlot], 'right')).toEqual({
      ok: true,
      fromId: 'a',
      x: rightSlot.x,
      y: anchor.y + NODE_H + GAP_Y,
    });
    const leftX = anchor.x - NODE_W - GAP_X;
    expect(planGrow('child', 'a', [], anchor, [anchor, { x: leftX, y: anchor.y, w: NODE_W, h: NODE_H }], 'left')).toMatchObject({
      x: leftX,
      y: anchor.y + NODE_H + GAP_Y,
    });
    const downY = anchor.y + anchor.h + GAP_Y;
    expect(planGrow('child', 'a', [], anchor, [anchor, { x: anchor.x, y: downY, w: NODE_W, h: NODE_H }], 'down')).toMatchObject({
      x: anchor.x + NODE_W + GAP_X,
      y: downY,
    });
    const upY = anchor.y - NODE_H - GAP_Y;
    expect(planGrow('child', 'a', [], anchor, [anchor, { x: anchor.x, y: upY, w: NODE_W, h: NODE_H }], 'up')).toMatchObject({
      x: anchor.x + NODE_W + GAP_X,
      y: upY,
    });
  });

  it('图片点按自己的宽高让开', () => {
    const image = { x: 10, y: 20, w: 220, h: 180 };
    const child = planGrow('child', 'img', [], image, [image]);
    const sibling = planGrow('sibling', 'img', [], image, [image]);
    expect(child).toMatchObject({ x: image.x, y: image.y + image.h + GAP_Y });
    expect(sibling).toMatchObject({ fromId: null, x: image.x, y: image.y + image.h + GAP_Y });
  });

  it('一个上级时同级接在这个上级上，同一个起点只算一次', () => {
    const plan = planGrow(
      'sibling',
      'a',
      [
        { fromId: 'p', toId: 'a' },
        { fromId: 'p', toId: 'a' },
      ],
      anchor,
      [anchor],
    );
    expect(plan).toEqual({ ok: true, fromId: 'p', x: anchor.x, y: anchor.y + anchor.h + GAP_Y });
  });

  it('没有上级时同级不连边', () => {
    const plan = planGrow('sibling', 'a', [{ fromId: 'a', toId: 'a' }], anchor, [anchor]);
    expect(plan).toEqual({ ok: true, fromId: null, x: anchor.x, y: anchor.y + anchor.h + GAP_Y });
  });

  it('多个上级时不创建', () => {
    const plan = planGrow(
      'sibling',
      'a',
      [
        { fromId: 'p', toId: 'a' },
        { fromId: 'q', toId: 'a' },
      ],
      anchor,
      [anchor],
    );
    expect(plan).toEqual({ ok: false, message: GROW_SIBLING_BLOCKED });
  });
});
