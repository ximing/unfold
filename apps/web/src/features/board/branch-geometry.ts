export type BranchBox = { x: number; y: number; w: number; h: number };

export type BranchCurve = {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
};

type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

function centerOf(box: BranchBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** |dx| >= |dy| 时看 dx，否则看 dy。正 dx 右缘，负 dx 左缘，正 dy 下缘，负 dy 上缘。 */
function edgeSide(from: BranchBox, toward: { x: number; y: number }): EdgeSide {
  const center = centerOf(from);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function midpoint(box: BranchBox, side: EdgeSide): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (side === 'right') return { x: box.x + box.w, y: cy };
  if (side === 'left') return { x: box.x, y: cy };
  if (side === 'bottom') return { x: cx, y: box.y + box.h };
  return { x: cx, y: box.y };
}

function outward(side: EdgeSide): { x: number; y: number } {
  if (side === 'right') return { x: 1, y: 0 };
  if (side === 'left') return { x: -1, y: 0 };
  if (side === 'bottom') return { x: 0, y: 1 };
  return { x: 0, y: -1 };
}

function unit(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

/** 超过这个角度，到达方向不再贴着连线，改从进入方向转过来。 */
const ARRIVAL_MAX = (55 * Math.PI) / 180;

/** 箭头顺着父出口到子入口的来向。来向不进入这一边，或偏得太厉害时，只转 55°。 */
function arrivalDir(into: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const approach = unit(to.x - from.x, to.y - from.y);
  const dot = Math.min(1, Math.max(-1, into.x * approach.x + into.y * approach.y));
  if (dot <= 0) return into;
  const angle = Math.acos(dot);
  if (angle <= ARRIVAL_MAX) return approach;
  const cross = into.x * approach.y - into.y * approach.x;
  const sign = cross < 0 ? -1 : 1;
  const s = Math.sin(ARRIVAL_MAX) * sign;
  const c = Math.cos(ARRIVAL_MAX);
  return { x: into.x * c - into.y * s, y: into.x * s + into.y * c };
}

function coord(value: number): string {
  if (Object.is(value, -0)) return '0';
  return String(value);
}

export function branchCurve(parent: BranchBox, child: BranchBox): BranchCurve {
  const parentCenter = centerOf(parent);
  const childCenter = centerOf(child);
  const parentSide = edgeSide(parent, childCenter);
  const childSide = edgeSide(child, parentCenter);
  const p0 = midpoint(parent, parentSide);
  const p3 = midpoint(child, childSide);
  const distance = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const parentNormal = outward(parentSide);
  const childNormal = outward(childSide);
  // 竖直拉开、水平只隔一个 levelGap 时，按斜边取把手会比缝更长，曲线甩出两点并被视口裁掉。
  const along = (p3.x - p0.x) * parentNormal.x + (p3.y - p0.y) * parentNormal.y;
  const raw = Math.min(160, Math.max(24, distance * 0.45));
  const handle = along > 0 ? Math.min(raw, along / 2) : raw;
  const into = { x: -childNormal.x, y: -childNormal.y };
  const dir = arrivalDir(into, p0, p3);
  return {
    p0,
    p1: { x: p0.x + parentNormal.x * handle, y: p0.y + parentNormal.y * handle },
    p2: { x: p3.x - dir.x * handle, y: p3.y - dir.y * handle },
    p3,
  };
}

function cubicPath(curve: BranchCurve): string {
  return `M ${coord(curve.p0.x)} ${coord(curve.p0.y)} C ${coord(curve.p1.x)} ${coord(curve.p1.y)} ${coord(curve.p2.x)} ${coord(curve.p2.y)} ${coord(curve.p3.x)} ${coord(curve.p3.y)}`;
}

export function branchCubic(parent: BranchBox, child: BranchBox): string {
  return cubicPath(branchCurve(parent, child));
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** 在参数 t 处切开，返回从起点到该点的一段。 */
export function splitCubic(curve: BranchCurve, t: number): BranchCurve {
  const a = lerp(curve.p0, curve.p1, t);
  const b = lerp(curve.p1, curve.p2, t);
  const c = lerp(curve.p2, curve.p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  return { p0: curve.p0, p1: a, p2: d, p3: lerp(d, e, t) };
}

export function cubicAt(curve: BranchCurve, t: number): { x: number; y: number } {
  return splitCubic(curve, t).p3;
}

/** 联系从子指向父时反过来，箭头落到父级。 */
export function orientBranch(curve: BranchCurve, forward: boolean): BranchCurve {
  if (forward) return curve;
  return { p0: curve.p3, p1: curve.p2, p2: curve.p1, p3: curve.p0 };
}

export type BranchStroke = {
  d: string;
  /** 截断后的线尾。 */
  end: { x: number; y: number };
  /** 尖端在原终点，方向是到达切线。 */
  tip: { x: number; y: number; ux: number; uy: number };
};

/**
 * 线尾取曲线上离尖端正好 inset 的点。箭头从线尾指向尖端，底边中点就是线尾。
 */
export function branchDraw(curve: BranchCurve, inset: number): BranchStroke {
  const span = Math.hypot(curve.p3.x - curve.p0.x, curve.p3.y - curve.p0.y);
  const pull = Math.min(Math.max(0, inset), Math.max(0, span - 4));
  const tangent = unit(curve.p3.x - curve.p2.x, curve.p3.y - curve.p2.y);
  if (pull < 0.5) {
    return {
      d: cubicPath(curve),
      end: curve.p3,
      tip: { x: curve.p3.x, y: curve.p3.y, ux: tangent.x, uy: tangent.y },
    };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2;
    const point = splitCubic(curve, mid).p3;
    const dist = Math.hypot(curve.p3.x - point.x, curve.p3.y - point.y);
    if (dist > pull) lo = mid;
    else hi = mid;
  }
  const stroke = splitCubic(curve, lo);
  const dir = unit(curve.p3.x - stroke.p3.x, curve.p3.y - stroke.p3.y);
  return {
    d: cubicPath(stroke),
    end: stroke.p3,
    tip: { x: curve.p3.x, y: curve.p3.y, ux: dir.x, uy: dir.y },
  };
}

export type BranchItem = {
  id: string;
  parentId?: string | null;
  groupId?: string;
  face?: 'inclusion';
};

export type BranchPair = { parentId: string; childId: string };

function onOutline(item: BranchItem): boolean {
  return !item.groupId && item.face !== 'inclusion';
}

/** 当前画板上要画的大纲父子。投影点、收起的子集合、缺父或缺盒子都不画。 */
export function branchPairs(items: readonly BranchItem[], boxes: ReadonlyMap<string, BranchBox>): BranchPair[] {
  const eligible = new Map<string, BranchItem>();
  for (const item of items) {
    if (!onOutline(item) || !boxes.has(item.id)) continue;
    eligible.set(item.id, item);
  }
  const pairs: BranchPair[] = [];
  for (const item of eligible.values()) {
    const parentId = item.parentId;
    if (!parentId || parentId === item.id || !eligible.has(parentId)) continue;
    pairs.push({ parentId, childId: item.id });
  }
  return pairs;
}

export function linksOnBranch<T extends { fromId: string; toId: string }>(pair: BranchPair, links: readonly T[]): T[] {
  return links.filter(
    (link) =>
      (link.fromId === pair.parentId && link.toId === pair.childId) ||
      (link.fromId === pair.childId && link.toId === pair.parentId),
  );
}

/** 父子联系的标签落在分支曲线中点。不是父子则没有这个点。 */
export function branchRelationPoint(
  items: readonly BranchItem[],
  boxes: ReadonlyMap<string, BranchBox>,
  fromId: string,
  toId: string,
): { x: number; y: number } | null {
  for (const pair of branchPairs(items, boxes)) {
    const parent = boxes.get(pair.parentId);
    const child = boxes.get(pair.childId);
    if (!parent || !child) continue;
    const forward = pair.parentId === fromId && pair.childId === toId;
    const back = pair.parentId === toId && pair.childId === fromId;
    if (!forward && !back) continue;
    return cubicAt(orientBranch(branchCurve(parent, child), forward), 0.5);
  }
  return null;
}

/** 已经画在父子分支上的联系，通用边层不再画第二遍。 */
export function branchLinkIds(
  items: readonly BranchItem[],
  boxes: ReadonlyMap<string, BranchBox>,
  links: readonly { id: string; fromId: string; toId: string }[],
): Set<string> {
  const ids = new Set<string>();
  for (const pair of branchPairs(items, boxes)) {
    for (const link of linksOnBranch(pair, links)) ids.add(link.id);
  }
  return ids;
}
