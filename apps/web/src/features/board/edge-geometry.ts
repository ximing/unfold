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
