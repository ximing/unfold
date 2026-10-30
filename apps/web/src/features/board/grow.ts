import type { CanvasGrow } from '@unfold/dto';
import { GAP_X, GAP_Y, NODE_H, NODE_W } from './board-layout.js';

export const GROW_W = NODE_W;
export const GROW_H = NODE_H;

type Box = { x: number; y: number; w: number; h: number };

export type GrowRole = 'beside' | 'below';

function overlaps(left: Box, right: Box): boolean {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

/**
 * beside 沿账号方向贴在旁边。below 始终在下方。
 * 左右被挡住就向下让，上下被挡住就向右让。下方被挡住就继续向下。
 */
function placeGrow(anchor: Box, boxes: readonly Box[], direction: CanvasGrow | 'below'): { x: number; y: number } {
  const dir = direction === 'below' ? 'down' : direction;
  let x = anchor.x;
  let y = anchor.y;
  if (dir === 'right') x = anchor.x + anchor.w + GAP_X;
  else if (dir === 'left') x = anchor.x - GROW_W - GAP_X;
  else if (dir === 'down') y = anchor.y + anchor.h + GAP_Y;
  else y = anchor.y - GROW_H - GAP_Y;
  const draft = { x, y, w: GROW_W, h: GROW_H };
  const stepDown = direction === 'below' || dir === 'left' || dir === 'right';
  for (let guard = 0; guard < 64 && boxes.some((box) => overlaps(draft, box)); guard += 1) {
    if (stepDown) y += GROW_H + GAP_Y;
    else x += GROW_W + GAP_X;
    draft.x = x;
    draft.y = y;
  }
  return { x, y };
}

/** 只决定落点。不返回连边起点，也不带关系标签。 */
export function planGrow(
  role: GrowRole,
  anchor: Box,
  boxes: readonly Box[],
  direction: CanvasGrow = 'down',
): { x: number; y: number } {
  return placeGrow(anchor, boxes, role === 'below' ? 'below' : direction);
}
