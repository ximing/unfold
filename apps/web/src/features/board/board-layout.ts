export type BoardItem = { id: string };
export type BoardLink = { fromId: string; toId: string };
export type BoardBox = { id: string; x: number; y: number; w: number; h: number };

const NODE_W = 168;
const NODE_H = 56;
const GAP_X = 36;
const GAP_Y = 28;
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
