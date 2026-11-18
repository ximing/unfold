/** 合集画板上单个直接成员的拖拽落点。不改坐标，也不写大纲。 */

export const MINDMAP_SEAM_PX = 8;

export type MindmapDropKind = 'member' | 'projected' | 'chip' | 'uploading';

export type MindmapDropNode = {
  id: string;
  parentId: string | null;
  order: number;
  kind: MindmapDropKind;
};

export type MindmapDropBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
};

export type MindmapSeamLine = { x1: number; x2: number; y: number };

export type MindmapOutlineItem = { nodeId: string; parentId: string | null; order: number };

export type MindmapDrop =
  | { type: 'cancel'; seam: MindmapSeamLine | null }
  | { type: 'anchor' }
  | { type: 'structure'; items: MindmapOutlineItem[]; anchor: boolean; seam: MindmapSeamLine | null };

export type MindmapDragItem = {
  id: string;
  parentId?: string | null;
  groupId?: string | null;
  face?: 'inclusion';
  uploading?: boolean;
};

export type MindmapDragRole = 'reparent' | 'places' | 'block';

type Row = { id: string; order: number };

function compareId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function byOrder(a: Row, b: Row): number {
  if (a.order !== b.order) return a.order - b.order;
  return compareId(a.id, b.id);
}

function contains(box: MindmapDropBox, pointer: { x: number; y: number }): boolean {
  return pointer.x >= box.x && pointer.x <= box.x + box.w && pointer.y >= box.y && pointer.y <= box.y + box.h;
}

/** 直接成员才进大纲。芯片和上传中先于投影点，避免芯片被当成投影。 */
export function mindmapDropKind(item: MindmapDragItem): MindmapDropKind {
  if (item.uploading === true || item.id.startsWith('uploading:')) return 'uploading';
  if (item.face === 'inclusion' || item.id.startsWith('inclusion:')) return 'chip';
  if (item.groupId != null) return 'projected';
  return 'member';
}

/** 单个直接成员改父级。单个投影点或多选全是根只平移。其余不开始拖动。 */
export function mindmapDragRole(ids: readonly string[], items: readonly MindmapDragItem[]): MindmapDragRole {
  if (ids.length === 0) return 'block';
  const byId = new Map(items.map((item) => [item.id, item]));
  const roleOf = (id: string) => {
    const item = byId.get(id);
    if (!item) return 'missing';
    const kind = mindmapDropKind(item);
    if (kind !== 'member') return kind;
    return item.parentId ? 'child' : 'root';
  };
  if (ids.length === 1) {
    const role = roleOf(ids[0] ?? '');
    if (role === 'root' || role === 'child') return 'reparent';
    if (role === 'projected') return 'places';
    return 'block';
  }
  return ids.every((id) => roleOf(id) === 'root') ? 'places' : 'block';
}

/** 被拖点在前，然后是直接成员里的后代。调用方自己丢掉没有盒子的 id。 */
export function mindmapFollowerIds(
  draggedId: string,
  nodes: readonly { id: string; parentId: string | null }[],
): string[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const child of children.get(id) ?? []) walk(child);
  };
  walk(draggedId);
  return out;
}

function rewrite(
  members: readonly MindmapDropNode[],
  draggedId: string,
  parentId: string | null,
  beforeId: string | null,
): MindmapOutlineItem[] {
  const groups = new Map<string | null, Row[]>();
  for (const node of members) {
    if (node.id === draggedId) continue;
    const list = groups.get(node.parentId) ?? [];
    list.push({ id: node.id, order: node.order });
    groups.set(node.parentId, list);
  }
  for (const list of groups.values()) list.sort(byOrder);
  const dest = groups.get(parentId) ?? [];
  let index = dest.length;
  if (beforeId !== null) {
    const found = dest.findIndex((item) => item.id === beforeId);
    if (found >= 0) index = found;
  }
  dest.splice(index, 0, { id: draggedId, order: 0 });
  groups.set(parentId, dest);
  const placed = new Map<string, { parentId: string | null; order: number }>();
  for (const [key, list] of groups) {
    list.forEach((item, order) => placed.set(item.id, { parentId: key, order }));
  }
  return members.map((node) => {
    const next = placed.get(node.id);
    // parentId 为 null 表示根，不能用 ?? 掉回去。
    return next
      ? { nodeId: node.id, parentId: next.parentId, order: next.order }
      : { nodeId: node.id, parentId: node.parentId, order: node.order };
  });
}

/** 命中要落在上盒或下盒的 x 区间。重叠或相接画并集；分开只画指针所在的一段。 */
function seamLine(above: MindmapDropBox, below: MindmapDropBox, x: number, y: number): MindmapSeamLine | null {
  const aboveRight = above.x + above.w;
  const belowRight = below.x + below.w;
  const onAbove = x >= above.x && x <= aboveRight;
  const onBelow = x >= below.x && x <= belowRight;
  if (!onAbove && !onBelow) return null;
  if (aboveRight < below.x || belowRight < above.x) {
    return onAbove ? { x1: above.x, x2: aboveRight, y } : { x1: below.x, x2: belowRight, y };
  }
  return { x1: Math.min(above.x, below.x), x2: Math.max(aboveRight, belowRight), y };
}

/**
 * 缝优先于盒子。顺序里的前一项是上、后一项是下。
 * 自己、自己的后代、芯片、上传中都不是新父级；后三类以及落在自己子树上的缝整笔取消。
 * 投影点既不是缝也不是新父级，会落到后面的空白规则。
 */
export function resolveMindmapDrop(input: {
  draggedId: string;
  pointer: { x: number; y: number };
  nodes: readonly MindmapDropNode[];
  boxes: readonly MindmapDropBox[];
}): MindmapDrop {
  const members = input.nodes.filter((node) => node.kind === 'member');
  const dragged = members.find((node) => node.id === input.draggedId);
  if (!dragged) return { type: 'cancel', seam: null };

  const boxOf = new Map(input.boxes.map((box) => [box.id, box]));
  const groups = new Map<string | null, MindmapDropNode[]>();
  for (const node of members) {
    if (node.id === input.draggedId) continue;
    const list = groups.get(node.parentId) ?? [];
    list.push(node);
    groups.set(node.parentId, list);
  }

  type SeamHit = {
    parentId: string | null;
    afterId: string;
    line: MindmapSeamLine;
    distance: number;
  };
  const seams: SeamHit[] = [];
  for (const [parentId, list] of groups) {
    const visible = [...list].sort(byOrder).filter((node) => boxOf.has(node.id));
    for (let index = 0; index < visible.length - 1; index += 1) {
      const upper = visible[index];
      const lower = visible[index + 1];
      if (!upper || !lower) continue;
      const above = boxOf.get(upper.id);
      const below = boxOf.get(lower.id);
      if (!above || !below) continue;
      const y = (above.y + above.h + below.y) / 2;
      const distance = Math.abs(input.pointer.y - y);
      if (distance >= MINDMAP_SEAM_PX) continue;
      const line = seamLine(above, below, input.pointer.x, y);
      if (!line) continue;
      seams.push({ parentId, afterId: lower.id, line, distance });
    }
  }
  seams.sort(
    (a, b) => a.distance - b.distance || a.line.y - b.line.y || a.line.x1 - b.line.x1 || compareId(a.afterId, b.afterId),
  );
  const seam = seams[0];

  const parentOf = new Map(members.map((node) => [node.id, node.parentId]));
  const descendant = (id: string) => {
    const seen = new Set<string>();
    let current = parentOf.get(id) ?? null;
    while (current !== null && !seen.has(current)) {
      if (current === input.draggedId) return true;
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
    return false;
  };

  if (seam) {
    if (seam.parentId !== null && (seam.parentId === input.draggedId || descendant(seam.parentId))) {
      return { type: 'cancel', seam: seam.line };
    }
    return {
      type: 'structure',
      items: rewrite(members, input.draggedId, seam.parentId, seam.afterId),
      anchor: seam.parentId === null,
      seam: seam.line,
    };
  }

  const hits = input.boxes
    .map((box, index) => ({ box, index }))
    .filter(({ box }) => box.id !== input.draggedId && contains(box, input.pointer))
    .sort((a, b) => (b.box.z ?? 0) - (a.box.z ?? 0) || b.index - a.index);
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  for (const { box } of hits) {
    const node = byId.get(box.id);
    if (!node) continue;
    if (node.kind === 'chip' || node.kind === 'uploading') return { type: 'cancel', seam: null };
    if (node.kind === 'projected') continue;
    if (descendant(node.id)) return { type: 'cancel', seam: null };
    return {
      type: 'structure',
      items: rewrite(members, input.draggedId, node.id, null),
      anchor: false,
      seam: null,
    };
  }

  if (dragged.parentId === null) return { type: 'anchor' };
  return {
    type: 'structure',
    items: rewrite(members, input.draggedId, null, null),
    anchor: true,
    seam: null,
  };
}
