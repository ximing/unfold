export type EdgeBox = { x: number; y: number; w: number; h: number };
export type EdgeEnds = { x1: number; y1: number; x2: number; y2: number };
export type EdgeLane = { index: number; count: number; paired: boolean };

const LANE_GAP = 16;

function unit(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** 从盒子中心沿 (dx, dy) 走到边框。 */
function borderExit(box: EdgeBox, dx: number, dy: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dir = unit(dx, dy);
  const hw = box.w / 2;
  const hh = box.h / 2;
  let t = Number.POSITIVE_INFINITY;
  if (Math.abs(dir.x) > 1e-9) t = Math.min(t, hw / Math.abs(dir.x));
  if (Math.abs(dir.y) > 1e-9) t = Math.min(t, hh / Math.abs(dir.y));
  if (!Number.isFinite(t)) return { x: cx, y: cy };
  return { x: cx + dir.x * t, y: cy + dir.y * t };
}

/**
 * 同向多条以中线为轴、间距 16 错开。
 * 与反向边成对时整组偏到本方向法线正侧；反向边的法线相反，所以落在另一侧。
 */
function laneOffset(index: number, count: number, paired: boolean): number {
  const total = Math.max(1, count);
  const slot = Math.min(total - 1, Math.max(0, index));
  if (paired) return LANE_GAP * (slot + 0.5);
  return LANE_GAP * (slot - (total - 1) / 2);
}

/** 中心连线与两边框的交点，再沿法线错开。 */
export function edgeGeometry(
  from: EdgeBox,
  to: EdgeBox,
  index: number,
  count: number,
  paired: boolean,
): EdgeEnds {
  const c1x = from.x + from.w / 2;
  const c1y = from.y + from.h / 2;
  const c2x = to.x + to.w / 2;
  const c2y = to.y + to.h / 2;
  const dir = unit(c2x - c1x, c2y - c1y);
  const start = borderExit(from, dir.x, dir.y);
  const end = borderExit(to, -dir.x, -dir.y);
  const offset = laneOffset(index, count, paired);
  const nx = -dir.y;
  const ny = dir.x;
  return {
    x1: start.x + nx * offset,
    y1: start.y + ny * offset,
    x2: end.x + nx * offset,
    y2: end.y + ny * offset,
  };
}

export function edgeMidpoint(ends: EdgeEnds): { x: number; y: number } {
  return { x: (ends.x1 + ends.x2) / 2, y: (ends.y1 + ends.y2) / 2 };
}

export type EdgeRoute = 'straight' | 'curve' | 'orthogonal';

/** 箭头尖端在终点边框上。线只画到箭头底部。 */
export const ARROW_LEN = 8;
export const ARROW_HALF = 3.5;

export type EdgeTip = { x: number; y: number; ux: number; uy: number };

export type EdgeDraw = { d: string; label: { x: number; y: number }; tip: EdgeTip };

const CORNER = 12;

function retreat(end: { x: number; y: number }, dir: { x: number; y: number }, inset: number, room: number): { x: number; y: number } {
  const pull = Math.min(Math.max(0, inset), Math.max(0, room - 4));
  return { x: end.x - dir.x * pull, y: end.y - dir.y * pull };
}

function lineDraw(ends: EdgeEnds, inset: number): EdgeDraw {
  const dx = ends.x2 - ends.x1;
  const dy = ends.y2 - ends.y1;
  const len = Math.hypot(dx, dy);
  const dir = unit(dx, dy);
  const end = retreat({ x: ends.x2, y: ends.y2 }, dir, inset, len);
  return {
    d: `M ${ends.x1} ${ends.y1} L ${end.x} ${end.y}`,
    label: edgeMidpoint(ends),
    tip: { x: ends.x2, y: ends.y2, ux: dir.x, uy: dir.y },
  };
}

/** 箭头三角形。尖端在 tip，底边离开尖端 ARROW_LEN。 */
export function arrowPath(tip: EdgeTip, length = ARROW_LEN, half = ARROW_HALF): string {
  const bx = tip.x - tip.ux * length;
  const by = tip.y - tip.uy * length;
  const lx = bx - tip.uy * half;
  const ly = by + tip.ux * half;
  const rx = bx + tip.uy * half;
  const ry = by - tip.ux * half;
  return `M ${tip.x} ${tip.y} L ${lx} ${ly} L ${rx} ${ry} Z`;
}

function curveDraw(ends: EdgeEnds, inset: number): EdgeDraw {
  const dx = ends.x2 - ends.x1;
  const dy = ends.y2 - ends.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return lineDraw(ends, inset);
  const dir = unit(dx, dy);
  const bow = Math.min(len * 0.2, 80);
  const nx = -dir.y;
  const ny = dir.x;
  const c1x = ends.x1 + dir.x * (len / 3) + nx * bow;
  const c1y = ends.y1 + dir.y * (len / 3) + ny * bow;
  const c2x = ends.x1 + dir.x * ((2 * len) / 3) + nx * bow;
  const c2y = ends.y1 + dir.y * ((2 * len) / 3) + ny * bow;
  const tan = unit(ends.x2 - c2x, ends.y2 - c2y);
  const room = Math.hypot(ends.x2 - c2x, ends.y2 - c2y);
  const end = retreat({ x: ends.x2, y: ends.y2 }, tan, inset, room);
  const shiftX = ends.x2 - end.x;
  const shiftY = ends.y2 - end.y;
  return {
    d: `M ${ends.x1} ${ends.y1} C ${c1x} ${c1y} ${c2x - shiftX} ${c2y - shiftY} ${end.x} ${end.y}`,
    label: {
      x: (ends.x1 + 3 * c1x + 3 * c2x + ends.x2) / 8,
      y: (ends.y1 + 3 * c1y + 3 * c2y + ends.y2) / 8,
    },
    tip: { x: ends.x2, y: ends.y2, ux: tan.x, uy: tan.y },
  };
}

function clamp(value: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, value));
}

function dedupePoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const kept: { x: number; y: number }[] = [];
  for (const point of points) {
    const prev = kept[kept.length - 1];
    if (prev && Math.hypot(point.x - prev.x, point.y - prev.y) < 0.5) continue;
    kept.push(point);
  }
  return kept;
}

function roundedPolyline(points: { x: number; y: number }[]): { d: string; label: { x: number; y: number } } {
  const unique = dedupePoints(points);
  if (unique.length < 2) {
    const only = unique[0] ?? { x: 0, y: 0 };
    return { d: `M ${only.x} ${only.y}`, label: only };
  }
  let best = -1;
  let label = unique[0] ?? { x: 0, y: 0 };
  for (let index = 0; index < unique.length - 1; index += 1) {
    const from = unique[index];
    const to = unique[index + 1];
    if (!from || !to) continue;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len >= best) {
      best = len;
      label = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    }
  }
  const parts = [`M ${unique[0]?.x ?? 0} ${unique[0]?.y ?? 0}`];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const prev = unique[index - 1];
    const curr = unique[index];
    const next = unique[index + 1];
    if (!prev || !curr || !next) continue;
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y);
    const radius = Math.min(CORNER, inLen / 2, outLen / 2);
    if (radius < 0.5 || inLen < 1e-6 || outLen < 1e-6) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }
    const inX = (curr.x - prev.x) / inLen;
    const inY = (curr.y - prev.y) / inLen;
    const outX = (next.x - curr.x) / outLen;
    const outY = (next.y - curr.y) / outLen;
    const ax = curr.x - inX * radius;
    const ay = curr.y - inY * radius;
    const bx = curr.x + outX * radius;
    const by = curr.y + outY * radius;
    parts.push(`L ${ax} ${ay} Q ${curr.x} ${curr.y} ${bx} ${by}`);
  }
  const last = unique[unique.length - 1];
  parts.push(`L ${last?.x ?? 0} ${last?.y ?? 0}`);
  return { d: parts.join(' '), label };
}

function orthogonalDraw(from: EdgeBox, to: EdgeBox, index: number, count: number, paired: boolean, inset: number): EdgeDraw {
  const c1x = from.x + from.w / 2;
  const c1y = from.y + from.h / 2;
  const c2x = to.x + to.w / 2;
  const c2y = to.y + to.h / 2;
  const off = laneOffset(index, count, paired);
  const horizontal = Math.abs(c2x - c1x) >= Math.abs(c2y - c1y);
  if (horizontal) {
    const leaveRight = c2x >= c1x;
    const start = {
      x: leaveRight ? from.x + from.w : from.x,
      y: clamp(c1y + off, from.y + 8, from.y + from.h - 8),
    };
    const end = {
      x: leaveRight ? to.x : to.x + to.w,
      y: clamp(c2y + off, to.y + 8, to.y + to.h - 8),
    };
    const arrive = { x: leaveRight ? 1 : -1, y: 0 };
    const midX = (start.x + end.x) / 2;
    const elbow = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    const pulled = retreat(end, arrive, inset, Math.abs(end.x - start.x));
    return {
      d: roundedPolyline([start, { x: midX, y: start.y }, { x: midX, y: end.y }, pulled]).d,
      label: roundedPolyline(elbow).label,
      tip: { x: end.x, y: end.y, ux: arrive.x, uy: arrive.y },
    };
  }
  const leaveDown = c2y >= c1y;
  const start = {
    x: clamp(c1x + off, from.x + 8, from.x + from.w - 8),
    y: leaveDown ? from.y + from.h : from.y,
  };
  const end = {
    x: clamp(c2x + off, to.x + 8, to.x + to.w - 8),
    y: leaveDown ? to.y : to.y + to.h,
  };
  const arrive = { x: 0, y: leaveDown ? 1 : -1 };
  const midY = (start.y + end.y) / 2;
  const elbow = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  const pulled = retreat(end, arrive, inset, Math.abs(end.y - start.y));
  return {
    d: roundedPolyline([start, { x: start.x, y: midY }, { x: end.x, y: midY }, pulled]).d,
    label: roundedPolyline(elbow).label,
    tip: { x: end.x, y: end.y, ux: arrive.x, uy: arrive.y },
  };
}

/** 直线、轻度曲线或圆角折线。标签落在看得见的中点。arrowInset 把线尾从终点边框往回缩。 */
export function edgeDraw(
  from: EdgeBox,
  to: EdgeBox,
  index: number,
  count: number,
  paired: boolean,
  route: EdgeRoute,
  arrowInset = 0,
): EdgeDraw {
  if (route === 'orthogonal') return orthogonalDraw(from, to, index, count, paired, arrowInset);
  const ends = edgeGeometry(from, to, index, count, paired);
  return route === 'curve' ? curveDraw(ends, arrowInset) : lineDraw(ends, arrowInset);
}

/** 临时线从盒子边框朝向指针的那一点出发。 */
export function anchorOnBorder(box: EdgeBox, toward: { x: number; y: number }): { x: number; y: number } {
  return borderExit(box, toward.x - (box.x + box.w / 2), toward.y - (box.y + box.h / 2));
}

/** 同一有向端点按边 id 字典序编号。存在反向边时 paired 为真。 */
export function edgeLanes(links: readonly { id: string; fromId: string; toId: string }[]): Map<string, EdgeLane> {
  const groups = new Map<string, { id: string; fromId: string; toId: string }[]>();
  for (const link of links) {
    const key = `${link.fromId}\0${link.toId}`;
    const list = groups.get(key);
    if (list) list.push(link);
    else groups.set(key, [link]);
  }
  const lanes = new Map<string, EdgeLane>();
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const split = key.indexOf('\0');
    const fromId = key.slice(0, split);
    const toId = key.slice(split + 1);
    const paired = fromId !== toId && groups.has(`${toId}\0${fromId}`);
    sorted.forEach((link, index) => {
      lanes.set(link.id, { index, count: sorted.length, paired });
    });
  }
  return lanes;
}
