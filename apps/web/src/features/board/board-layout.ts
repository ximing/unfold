export type BoardItem = { id: string };
export type BoardLink = { fromId: string; toId: string };
export type BoardBox = { id: string; x: number; y: number; w: number; h: number };

export const NODE_W = 168;
export const NODE_H = 56;
/** 有描述时放下名字、两行描述和底部色点。 */
export const NODE_DESC_H = 74;

export function textNodeHeight(description: string | null | undefined): number {
  return (description ?? '').trim() === '' ? NODE_H : NODE_DESC_H;
}
export const GAP_X = 36;
export const GAP_Y = 28;
const LAYER_STEP = 220;
const ORIGIN_X = 32;
const ORIGIN_Y = 48;

function row(items: readonly BoardItem[]): BoardBox[] {
  return items.map((item, index) => ({
    id: item.id,
    x: ORIGIN_X + index * (NODE_W + GAP_X),
    y: ORIGIN_Y,
    w: NODE_W,
    h: NODE_H,
  }));
}

export function layoutBoard(items: readonly BoardItem[], links: readonly BoardLink[]): BoardBox[] {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);
  const idSet = new Set(ids);
  const edges = links.filter(
    (link) => link.fromId !== link.toId && idSet.has(link.fromId) && idSet.has(link.toId),
  );
  if (edges.length === 0) return row(items);

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    indegree.set(edge.toId, (indegree.get(edge.toId) ?? 0) + 1);
    outgoing.get(edge.fromId)?.push(edge.toId);
  }

  const order = new Map(ids.map((id, index) => [id, index]));
  const byOrder = (left: string, right: string) => (order.get(left) ?? 0) - (order.get(right) ?? 0);
  let frontier = ids.filter((id) => indegree.get(id) === 0).sort(byOrder);
  if (frontier.length === 0) return row(items);

  const layers: string[][] = [];
  const placed = new Set<string>();
  while (frontier.length > 0) {
    layers.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      placed.add(id);
      for (const to of outgoing.get(id) ?? []) {
        const left = (indegree.get(to) ?? 0) - 1;
        indegree.set(to, left);
        if (left === 0) next.push(to);
      }
    }
    frontier = next.sort(byOrder);
  }

  if (placed.size !== ids.length) return row(items);

  return layers.flatMap((layer, layerIndex) =>
    layer.map((id, index) => ({
      id,
      x: ORIGIN_X + layerIndex * LAYER_STEP,
      y: ORIGIN_Y + index * (NODE_H + GAP_Y),
      w: NODE_W,
      h: NODE_H,
    })),
  );
}

export type SavedBoardItem = BoardItem & { x: number | null; y: number | null };

const NUDGE = 24;
const CLEARANCE = 1;

export function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 左上角从 center 开始；与任一已占用左上角距离小于 1 时，x、y 各加 24，直到让开。 */
export function placeNewCorners(
  count: number,
  center: { x: number; y: number },
  occupied: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  const taken = occupied.map((point) => ({ x: point.x, y: point.y }));
  const placed: { x: number; y: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    let x = center.x;
    let y = center.y;
    while (taken.some((point) => Math.hypot(point.x - x, point.y - y) < CLEARANCE)) {
      x += NUDGE;
      y += NUDGE;
    }
    const point = { x, y };
    taken.push(point);
    placed.push(point);
  }
  return placed;
}

/**
 * 全部 x 都不是有限数时，结果与 layoutBoard 相同。
 * 否则保留已有坐标，未放置的点用 placeNewCorners，宽高仍取 layoutBoard。
 */
export function layoutPlaced(
  items: readonly SavedBoardItem[],
  links: readonly BoardLink[],
  center: { x: number; y: number },
): BoardBox[] {
  const laid = layoutBoard(items, links);
  if (items.every((item) => !isFiniteNumber(item.x))) return laid;

  const byId = new Map(items.map((item) => [item.id, item]));
  const occupied: { x: number; y: number }[] = [];
  const missing: string[] = [];
  for (const box of laid) {
    const item = byId.get(box.id);
    if (item && isFiniteNumber(item.x)) occupied.push({ x: item.x, y: isFiniteNumber(item.y) ? item.y : 0 });
    else missing.push(box.id);
  }
  const corners = placeNewCorners(missing.length, center, occupied);
  const cornerOf = new Map(missing.map((id, index) => [id, corners[index]]));
  return laid.map((box) => {
    const item = byId.get(box.id);
    if (item && isFiniteNumber(item.x)) {
      return { ...box, x: item.x, y: isFiniteNumber(item.y) ? item.y : 0 };
    }
    const corner = cornerOf.get(box.id);
    return corner ? { ...box, x: corner.x, y: corner.y } : box;
  });
}

/** null 当 0，再加 1。没有数时结果是 1。 */
export function nextPlacementZ(values: readonly (number | null | undefined)[]): number {
  let max = 0;
  for (const value of values) {
    if (isFiniteNumber(value) && value > max) max = value;
  }
  return max + 1;
}
