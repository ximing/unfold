export const MINDMAP_ROOT_GAP = 96;
export const MINDMAP_LEVEL_GAP = 72;
export const MINDMAP_SIBLING_GAP = 16;
export const MINDMAP_ORIGIN_X = 48;
export const MINDMAP_ORIGIN_Y = 48;

export type MindmapDirection = 'right' | 'left' | 'both';

export type MindmapNode = {
  id: string;
  parentId: string | null;
  order: number;
  /** 仅当父级是根且 direction 为 both 时读取。更深的点忽略。 */
  side: 'left' | 'right' | null;
  w: number;
  h: number;
};

export type MindmapInput = {
  nodes: readonly MindmapNode[];
  folded: ReadonlySet<string>;
  direction: MindmapDirection;
  /**
   * 子树布局原点（根的 x 与它对齐，根在子树高度里垂直居中）。
   * mindmap_anchored 为假时调用方传空 Map。
   */
  anchors: ReadonlyMap<string, { x: number; y: number }>;
  rootGap: number;
  levelGap: number;
  siblingGap: number;
  originX: number;
  originY: number;
  /** 父项 id → 在 levelGap 之外再加的像素。没有这张表时全部不加。 */
  levelExtra?: ReadonlyMap<string, number>;
};

export type MindmapBox = { id: string; x: number; y: number; w: number; h: number };

export type ObstacleRect = { x: number; y: number; w: number; h: number };

const OBSTACLE_GAP = 24;

type Measured = {
  id: string;
  w: number;
  h: number;
  subH: number;
  stackH: number;
  children: Measured[];
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function compareNodes(left: MindmapNode, right: MindmapNode): number {
  if (left.order !== right.order) return left.order - right.order;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function hasCycle(byId: ReadonlyMap<string, MindmapNode>): boolean {
  const state = new Map<string, number>();
  for (const start of byId.keys()) {
    let id: string | null = start;
    const trail: string[] = [];
    while (id !== null) {
      const mark = state.get(id) ?? 0;
      if (mark === 2) break;
      if (mark === 1) return true;
      state.set(id, 1);
      trail.push(id);
      id = byId.get(id)?.parentId ?? null;
    }
    for (const seen of trail) state.set(seen, 2);
  }
  return false;
}

function stackHeight(kids: readonly Measured[], siblingGap: number): number {
  if (kids.length === 0) return 0;
  let sum = 0;
  for (const kid of kids) sum += kid.subH;
  return sum + siblingGap * (kids.length - 1);
}

function addedGap(id: string, extra: ReadonlyMap<string, number> | undefined): number {
  const value = extra?.get(id);
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function placeList(
  kids: readonly Measured[],
  childLeft: number,
  top: number,
  subH: number,
  kidsStackH: number,
  siblingGap: number,
  levelGap: number,
  extra: ReadonlyMap<string, number> | undefined,
  out: MindmapBox[],
): void {
  if (kids.length === 0) return;
  let cursor = top + (subH - kidsStackH) / 2;
  for (let index = 0; index < kids.length; index += 1) {
    const kid = kids[index];
    if (!kid) continue;
    placeMeasured(kid, childLeft, cursor, siblingGap, levelGap, extra, out);
    cursor += kid.subH;
    if (index + 1 < kids.length) cursor += siblingGap;
  }
}

function placeMeasured(
  measured: Measured,
  left: number,
  top: number,
  siblingGap: number,
  levelGap: number,
  extra: ReadonlyMap<string, number> | undefined,
  out: MindmapBox[],
): void {
  out.push({
    id: measured.id,
    x: left,
    y: top + (measured.subH - measured.h) / 2,
    w: measured.w,
    h: measured.h,
  });
  placeList(
    measured.children,
    left + measured.w + levelGap + addedGap(measured.id, extra),
    top,
    measured.subH,
    measured.stackH,
    siblingGap,
    levelGap,
    extra,
    out,
  );
}

function mirrorAround(boxes: MindmapBox[], cx: number): void {
  for (const box of boxes) {
    const center = box.x + box.w / 2;
    box.x = 2 * cx - center - box.w / 2;
  }
}

function translate(boxes: MindmapBox[], dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const box of boxes) {
    box.x += dx;
    box.y += dy;
  }
}

function boundsOf(boxes: readonly MindmapBox[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return left.minX < right.maxX && left.maxX > right.minX && left.minY < right.maxY && left.maxY > right.minY;
}

function pushBelow(boxes: MindmapBox[], obstacles: readonly Bounds[]): void {
  if (obstacles.length === 0) return;
  for (let guard = 0; guard < obstacles.length; guard += 1) {
    const area = boundsOf(boxes);
    let floor = -Infinity;
    let hit = false;
    for (const obstacle of obstacles) {
      if (!boundsOverlap(area, obstacle)) continue;
      hit = true;
      if (obstacle.maxY > floor) floor = obstacle.maxY;
    }
    if (!hit) return;
    const dy = floor - area.minY;
    if (!(dy > 0)) return;
    translate(boxes, 0, dy);
  }
}

function rectsOverlap(left: ObstacleRect, right: ObstacleRect): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

function forestRect(boxes: readonly MindmapBox[]): ObstacleRect {
  const area = boundsOf(boxes);
  return { x: area.minX, y: area.minY, w: area.maxX - area.minX, h: area.maxY - area.minY };
}

export function layoutMindmap(input: MindmapInput): MindmapBox[] {
  const nodes = input.nodes;
  if (nodes.length === 0) return [];
  for (const node of nodes) {
    if (!isPositiveFinite(node.w) || !isPositiveFinite(node.h)) return [];
  }

  const byId = new Map<string, MindmapNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) return [];
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) return [];
  }
  if (hasCycle(byId)) return [];

  const children = new Map<string, MindmapNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }
  for (const list of children.values()) list.sort(compareNodes);

  const visibleKids = (id: string): readonly MindmapNode[] => {
    if (input.folded.has(id)) return [];
    return children.get(id) ?? [];
  };

  const measure = (node: MindmapNode): Measured => {
    const kids = visibleKids(node.id);
    const measuredKids = kids.map((kid) => measure(kid));
    if (measuredKids.length === 0) {
      return { id: node.id, w: node.w, h: node.h, subH: node.h, stackH: 0, children: measuredKids };
    }
    const stacked = stackHeight(measuredKids, input.siblingGap);
    return {
      id: node.id,
      w: node.w,
      h: node.h,
      subH: Math.max(node.h, stacked),
      stackH: stacked,
      children: measuredKids,
    };
  };

  const layoutRoot = (root: MindmapNode): MindmapBox[] => {
    if (input.direction !== 'both') {
      const boxes: MindmapBox[] = [];
      placeMeasured(measure(root), 0, 0, input.siblingGap, input.levelGap, input.levelExtra, boxes);
      if (input.direction === 'left') mirrorAround(boxes, root.w / 2);
      return boxes;
    }

    const left: Measured[] = [];
    const right: Measured[] = [];
    for (const kid of visibleKids(root.id)) {
      const measured = measure(kid);
      if (kid.side === 'left') left.push(measured);
      else right.push(measured);
    }
    const leftH = stackHeight(left, input.siblingGap);
    const rightH = stackHeight(right, input.siblingGap);
    const subH = Math.max(root.h, leftH, rightH);
    const boxes: MindmapBox[] = [
      { id: root.id, x: 0, y: (subH - root.h) / 2, w: root.w, h: root.h },
    ];
    const childLeft = root.w + input.levelGap + addedGap(root.id, input.levelExtra);
    placeList(right, childLeft, 0, subH, rightH, input.siblingGap, input.levelGap, input.levelExtra, boxes);
    const leftBoxes: MindmapBox[] = [];
    placeList(left, childLeft, 0, subH, leftH, input.siblingGap, input.levelGap, input.levelExtra, leftBoxes);
    mirrorAround(leftBoxes, root.w / 2);
    for (const box of leftBoxes) boxes.push(box);
    return boxes;
  };

  const roots = nodes.filter((node) => node.parentId === null).sort(compareNodes);
  const byRoot = new Map<string, MindmapBox[]>();
  const anchoredBounds: Bounds[] = [];
  const freePlaced: MindmapBox[][] = [];

  for (const root of roots) {
    const anchor = input.anchors.get(root.id);
    if (anchor === undefined) continue;
    const boxes = layoutRoot(root);
    translate(boxes, anchor.x, anchor.y);
    byRoot.set(root.id, boxes);
    anchoredBounds.push(boundsOf(boxes));
  }

  let top = input.originY;
  for (const root of roots) {
    if (input.anchors.has(root.id)) continue;
    const boxes = layoutRoot(root);
    translate(boxes, input.originX, top);
    pushBelow(boxes, anchoredBounds);
    const area = boundsOf(boxes);
    top = area.maxY + input.rootGap;
    freePlaced.push(boxes);
    byRoot.set(root.id, boxes);
  }

  let minX = Infinity;
  for (const boxes of freePlaced) {
    for (const box of boxes) minX = Math.min(minX, box.x);
  }
  if (minX < input.originX) {
    const dx = input.originX - minX;
    for (const boxes of freePlaced) translate(boxes, dx, 0);
  }

  const result: MindmapBox[] = [];
  for (const root of roots) {
    const boxes = byRoot.get(root.id);
    if (!boxes) continue;
    for (const box of boxes) result.push(box);
  }
  return result;
}

export function separateFromObstacles(
  boxes: readonly MindmapBox[],
  obstacles: readonly ObstacleRect[],
): MindmapBox[] {
  const placed = boxes.map((box) => ({ id: box.id, x: box.x, y: box.y, w: box.w, h: box.h }));
  if (placed.length === 0 || obstacles.length === 0) return placed;
  // 一次正向推移离开当前障碍。轮数用尽仍相交时停在最后位置。
  const rounds = obstacles.length + 1;
  for (let round = 0; round < rounds; round += 1) {
    const forest = forestRect(placed);
    const obstacle = obstacles.find((item) => rectsOverlap(forest, item));
    if (!obstacle) break;
    const moveRight = obstacle.x + obstacle.w + OBSTACLE_GAP - forest.x;
    const moveDown = obstacle.y + obstacle.h + OBSTACLE_GAP - forest.y;
    let dx = 0;
    let dy = 0;
    if (moveRight > 0 && moveDown > 0) {
      if (moveRight <= moveDown) dx = moveRight;
      else dy = moveDown;
    } else if (moveRight > 0) dx = moveRight;
    else if (moveDown > 0) dy = moveDown;
    else break;
    for (const box of placed) {
      box.x += dx;
      box.y += dy;
    }
  }
  return placed;
}
