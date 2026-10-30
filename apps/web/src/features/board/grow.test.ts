import { describe, expect, it } from 'vitest';
import { GAP_X, GAP_Y, NODE_H, NODE_W } from './board-layout.js';
import { planGrow } from './grow.js';

const anchor = { x: 32, y: 48, w: NODE_W, h: NODE_H };

describe('planGrow', () => {
  it('旁边默认放在下方，计划里没有连边', () => {
    const plan = planGrow('beside', anchor, [anchor]);
    expect(plan).toEqual({ x: anchor.x, y: anchor.y + anchor.h + GAP_Y });
    expect(plan).not.toHaveProperty('fromId');
    expect(plan).not.toHaveProperty('label');
  });

  it('旁边方向可以改成上、左、右', () => {
    expect(planGrow('beside', anchor, [anchor], 'up')).toEqual({
      x: anchor.x,
      y: anchor.y - NODE_H - GAP_Y,
    });
    expect(planGrow('beside', anchor, [anchor], 'left')).toEqual({
      x: anchor.x - NODE_W - GAP_X,
      y: anchor.y,
    });
    expect(planGrow('beside', anchor, [anchor], 'right')).toEqual({
      x: anchor.x + anchor.w + GAP_X,
      y: anchor.y,
    });
  });

  it('左右被挡住时向下让，上下被挡住时向右让', () => {
    const rightSlot = { x: anchor.x + anchor.w + GAP_X, y: anchor.y, w: NODE_W, h: NODE_H };
    expect(planGrow('beside', anchor, [anchor, rightSlot], 'right')).toEqual({
      x: rightSlot.x,
      y: anchor.y + NODE_H + GAP_Y,
    });
    const leftX = anchor.x - NODE_W - GAP_X;
    expect(planGrow('beside', anchor, [anchor, { x: leftX, y: anchor.y, w: NODE_W, h: NODE_H }], 'left')).toEqual({
      x: leftX,
      y: anchor.y + NODE_H + GAP_Y,
    });
    const downY = anchor.y + anchor.h + GAP_Y;
    expect(planGrow('beside', anchor, [anchor, { x: anchor.x, y: downY, w: NODE_W, h: NODE_H }], 'down')).toEqual({
      x: anchor.x + NODE_W + GAP_X,
      y: downY,
    });
    const upY = anchor.y - NODE_H - GAP_Y;
    expect(planGrow('beside', anchor, [anchor, { x: anchor.x, y: upY, w: NODE_W, h: NODE_H }], 'up')).toEqual({
      x: anchor.x + NODE_W + GAP_X,
      y: upY,
    });
  });

  it('图片点按自己的宽高让开', () => {
    const image = { x: 10, y: 20, w: 220, h: 180 };
    expect(planGrow('beside', image, [image])).toEqual({ x: image.x, y: image.y + image.h + GAP_Y });
    expect(planGrow('below', image, [image])).toEqual({ x: image.x, y: image.y + image.h + GAP_Y });
  });

  it('多个入边时下方仍然成功，计划里没有自动连边标签', () => {
    const plan = planGrow('below', anchor, [anchor]);
    expect(plan).toEqual({ x: anchor.x, y: anchor.y + anchor.h + GAP_Y });
    expect(plan).not.toHaveProperty('fromId');
    expect(plan).not.toHaveProperty('label');
  });
});
