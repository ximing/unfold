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

export type EdgeDraw = {
  d: string;
  label: { x: number; y: number };
  /** 单位向量。文字从中点沿它让开笔画，不再固定往屏幕上方抬。 */
  labelOut: { x: number; y: number };
  tip: EdgeTip;
};

const CORNER = 12;
/** 文字中心离开笔画的距离。 */
export const LABEL_LIFT = 12;

/** 小于这个夹角视为水平或垂直，不弯。 */
const CURVE_STRAIGHT = Math.tan((18 * Math.PI) / 180);
/** 夹角到这里时弯出满。 */
const CURVE_FULL = Math.tan((40 * Math.PI) / 180);
const CURVE_SAG_RATIO = 0.12;
const CURVE_SAG_MAX = 48;
const CURVE_HANDLE = 0.45;

function retreat(end: { x: number; y: number }, dir: { x: number; y: number }, inset: number, room: number): { x: number; y: number } {
  const pull = Math.min(Math.max(0, inset), Math.max(0, room - 4));
  return { x: end.x - dir.x * pull, y: end.y - dir.y * pull };
}

/** 水平线把字放在上方。垂直线只往旁边让，避免把字抬向起点。 */
function labelClearance(dir: { x: number; y: number }): { x: number; y: number } {
  let x = -dir.y;
  let y = dir.x;
  if (y > 0) {
    x = -x;
    y = -y;
  }
  return { x, y };
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
    labelOut: labelClearance(dir),
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

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** 弯向目标的上下一侧。右上向左上，左上向右上，下面两个方向向下。 */
function curveNormal(dir: { x: number; y: number }): { x: number; y: number } {
  let x = -dir.y;
  let y = dir.x;
  if (y * dir.y < 0) {
    x = -x;
    y = -y;
  }
  return { x, y };
}

/**
 * 接近水平或垂直时不弯。斜向用长把手的三次曲线：两端顺着连线离开，弯出集中在中段。
 */
function curveDraw(ends: EdgeEnds, inset: number): EdgeDraw {
  const dx = ends.x2 - ends.x1;
  const dy = ends.y2 - ends.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return lineDraw(ends, inset);
  const dir = unit(dx, dy);
  const normal = curveNormal(dir);
  const major = Math.max(Math.abs(dx), Math.abs(dy));
  const minor = Math.min(Math.abs(dx), Math.abs(dy));
  const ratio = major < 1e-6 ? 0 : minor / major;
  const fade = smoothstep((ratio - CURVE_STRAIGHT) / (CURVE_FULL - CURVE_STRAIGHT));
  const sag = fade * Math.min(len * CURVE_SAG_RATIO, CURVE_SAG_MAX);
  if (sag < 0.75) return lineDraw(ends, inset);
  const handle = len * CURVE_HANDLE;
  const off = sag / 0.75;
  const c1x = ends.x1 + dir.x * handle + normal.x * off;
  const c1y = ends.y1 + dir.y * handle + normal.y * off;
  const c2x = ends.x2 - dir.x * handle + normal.x * off;
  const c2y = ends.y2 - dir.y * handle + normal.y * off;
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
    labelOut: normal,
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

function roundedPolyline(points: { x: number; y: number }[]): {
  d: string;
  label: { x: number; y: number };
  labelDir: { x: number; y: number };
} {
  const unique = dedupePoints(points);
  if (unique.length < 2) {
    const only = unique[0] ?? { x: 0, y: 0 };
    return { d: `M ${only.x} ${only.y}`, label: only, labelDir: { x: 1, y: 0 } };
  }
  let best = -1;
  let label = unique[0] ?? { x: 0, y: 0 };
  let labelDir = { x: 1, y: 0 };
  for (let index = 0; index < unique.length - 1; index += 1) {
    const from = unique[index];
    const to = unique[index + 1];
    if (!from || !to) continue;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len >= best) {
      best = len;
      label = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      labelDir = unit(to.x - from.x, to.y - from.y);
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
  return { d: parts.join(' '), label, labelDir };
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
    const plain = roundedPolyline(elbow);
    return {
      d: roundedPolyline([start, { x: midX, y: start.y }, { x: midX, y: end.y }, pulled]).d,
      label: plain.label,
      labelOut: labelClearance(plain.labelDir),
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
  const plain = roundedPolyline(elbow);
  return {
    d: roundedPolyline([start, { x: start.x, y: midY }, { x: end.x, y: midY }, pulled]).d,
    label: plain.label,
    labelOut: labelClearance(plain.labelDir),
    tip: { x: end.x, y: end.y, ux: arrive.x, uy: arrive.y },
  };
}

/** 直线、平滑曲线或圆角折线。标签锚在中点。接近水平或垂直的曲线不弯。arrowInset 把线尾从终点边框往回缩。 */
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
