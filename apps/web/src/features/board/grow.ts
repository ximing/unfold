import { GAP_X, GAP_Y, NODE_H, NODE_W } from './board-layout.js';

export const GROW_W = NODE_W;
export const GROW_H = NODE_H;

export const GROW_SIBLING_BLOCKED = '这个点有多个上级，无法创建同级';

/** Tab 建下级时先写上的关系说明，之后可以改。 */
export const GROW_CHILD_LABEL = '下一级';

type Box = { x: number; y: number; w: number; h: number };
type Link = { fromId: string; toId: string };

export type GrowPlan =
  | { ok: true; fromId: string | null; x: number; y: number }
  | { ok: false; message: string };

/** 指向这个点的边的起点。同一个起点只算一次。自环不算。 */
function parentIds(nodeId: string, links: readonly Link[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const link of links) {
    if (link.toId !== nodeId || link.fromId === nodeId) continue;
    if (seen.has(link.fromId)) continue;
    seen.add(link.fromId);
    ids.push(link.fromId);
  }
  return ids;
}

function overlaps(left: Box, right: Box): boolean {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

/** 下级在右侧，同级在下方。挡住就按一格文字点的高度继续向下。 */
function placeGrow(anchor: Box, boxes: readonly Box[], side: 'right' | 'below'): { x: number; y: number } {
  const x = side === 'right' ? anchor.x + anchor.w + GAP_X : anchor.x;
  let y = side === 'right' ? anchor.y : anchor.y + anchor.h + GAP_Y;
  const draft = { x, y, w: GROW_W, h: GROW_H };
  for (let guard = 0; guard < 64 && boxes.some((box) => overlaps(draft, box)); guard += 1) {
    y += GROW_H + GAP_Y;
    draft.y = y;
  }
  return { x, y };
}

export function planGrow(
  role: 'child' | 'sibling',
  nodeId: string,
  links: readonly Link[],
  anchor: Box,
  boxes: readonly Box[],
): GrowPlan {
  if (role === 'child') {
    const at = placeGrow(anchor, boxes, 'right');
    return { ok: true, fromId: nodeId, x: at.x, y: at.y };
  }
  const parents = parentIds(nodeId, links);
  if (parents.length > 1) return { ok: false, message: GROW_SIBLING_BLOCKED };
  const at = placeGrow(anchor, boxes, 'below');
  return { ok: true, fromId: parents[0] ?? null, x: at.x, y: at.y };
}
