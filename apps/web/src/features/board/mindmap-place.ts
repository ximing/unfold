/** 和库存比，任一轴差达到这个值才写回。 */
const PLACE_EPS = 0.5;

export type MindmapStoredNode = {
  id: string;
  parentId: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
};

export type MindmapPlacement = {
  nodeId: string;
  x: number;
  y: number;
  z: number;
};

function resolveRoot(id: string, parentOf: ReadonlyMap<string, string | null>): string | null {
  const seen = new Set<string>();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const parent = parentOf.get(current);
    if (parent === undefined) return null;
    if (parent === null) return current;
    if (!parentOf.has(parent)) return null;
    current = parent;
  }
  return null;
}

function changed(stored: number | null, next: number): boolean {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return true;
  return Math.abs(stored - next) >= PLACE_EPS;
}

/** 这棵树的锚点：根盒子的 x，全体盒子的最小 y。缺父的点不当成根。 */
export function treeAnchor(
  rootId: string,
  nodes: readonly { id: string; parentId: string | null }[],
  boxes: readonly { id: string; x: number; y: number }[],
): { x: number; y: number } | null {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  if (resolveRoot(rootId, parentOf) !== rootId) return null;
  let rootX: number | null = null;
  let minY = Infinity;
  for (const box of boxes) {
    if (resolveRoot(box.id, parentOf) !== rootId) continue;
    if (box.y < minY) minY = box.y;
    if (box.id === rootId) rootX = box.x;
  }
  if (rootX === null || !Number.isFinite(minY)) return null;
  return { x: rootX, y: minY };
}

/**
 * 试算时锚点放在落点上，根盒子会比落点再偏一截。
 * 锚点减去这段，重算后根盒子的左上角才留在落点。写库的仍是锚点。
 */
export function anchorFromDrop(
  trialAnchor: { x: number; y: number },
  rootBox: { x: number; y: number },
  drop: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: trialAnchor.x - (rootBox.x - drop.x),
    y: trialAnchor.y - (rootBox.y - drop.y),
  };
}

/**
 * 新根的锚点。试算时先把锚点放在落点上，根盒子会比落点偏一截，再把这段减回去。
 * 其它根的锚点原样留下。落点是根盒子要留住的左上角。
 */
export function anchorForRootDrop(
  stored: ReadonlyMap<string, { x: number; y: number }>,
  rootId: string,
  drop: { x: number; y: number },
  layout: (anchors: ReadonlyMap<string, { x: number; y: number }>) => readonly { id: string; x: number; y: number }[],
): Map<string, { x: number; y: number }> | null {
  const trial = new Map(stored);
  trial.set(rootId, drop);
  const rootBox = layout(trial).find((box) => box.id === rootId);
  if (!rootBox) return null;
  const anchors = new Map(stored);
  anchors.set(rootId, anchorFromDrop(drop, rootBox, drop));
  return anchors;
}

/** 根写锚点，子项写盒子左上角。差小于 0.5px 的不写。空布局没有写入。 */
export function mindmapPlacements(
  nodes: readonly MindmapStoredNode[],
  boxes: readonly { id: string; x: number; y: number }[],
): MindmapPlacement[] {
  if (boxes.length === 0) return [];
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  const writes: MindmapPlacement[] = [];
  for (const box of boxes) {
    const node = nodeOf.get(box.id);
    if (!node) continue;
    const rootId = resolveRoot(box.id, parentOf);
    if (rootId === null) continue;
    const next =
      box.id === rootId ? treeAnchor(rootId, nodes, boxes) : { x: box.x, y: box.y };
    if (!next) continue;
    if (!changed(node.x, next.x) && !changed(node.y, next.y)) continue;
    const z = typeof node.z === 'number' && Number.isFinite(node.z) ? node.z : 0;
    writes.push({ nodeId: box.id, x: next.x, y: next.y, z });
  }
  return writes;
}
