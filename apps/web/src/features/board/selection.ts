import { snapPoint } from './snap.js';

export type Rect = { x: number; y: number; w: number; h: number };

export type PickMode = 'replace' | 'add' | 'toggle';

type Point = { x: number; y: number };

export function pickModeFromKeys(keys: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): PickMode {
  if (keys.metaKey || keys.ctrlKey) return 'toggle';
  if (keys.shiftKey) return 'add';
  return 'replace';
}

export function normalizeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  };
}

function intersects(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

/** 矩形碰到的点。没有面积的点按不中。水平或垂直的一条线可以切过点。 */
export function nodesInRect(nodes: readonly (Rect & { id: string })[], rect: Rect): string[] {
  if (rect.w === 0 && rect.h === 0) return [];
  return nodes.filter((node) => intersects(node, rect)).map((node) => node.id);
}

export function applyPick(current: readonly string[], id: string, mode: PickMode): string[] {
  if (mode === 'replace') return [id];
  if (mode === 'add') return current.includes(id) ? [...current] : [...current, id];
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

/** additive 为假时用框中的点替换。框不中时变成没有选中。加选只补上新的，不拿掉框外的。 */
export function applyMarquee(current: readonly string[], hits: readonly string[], additive: boolean): string[] {
  if (!additive) return [...hits];
  const next = [...current];
  for (const id of hits) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

/** 被抓住的点贴格后的位移。整组共用这一段，相对位置不变。 */
export function moveDelta(origin: Point, startWorld: Point, nowWorld: Point, snap: boolean): { dx: number; dy: number } {
  const next = snapPoint(
    { x: origin.x + (nowWorld.x - startWorld.x), y: origin.y + (nowWorld.y - startWorld.y) },
    snap,
  );
  return { dx: next.x - origin.x, dy: next.y - origin.y };
}

/** 被抓住的点排在最后，松手后叠在最上。 */
export function stackOrder(ids: readonly string[], anchorId: string): string[] {
  const rest = ids.filter((id) => id !== anchorId);
  return ids.includes(anchorId) ? [...rest, anchorId] : [...ids];
}
