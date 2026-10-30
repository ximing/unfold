export type OutlineItem = {
  nodeId: string;
  parentId: string | null;
  order: number;
};

function compareNodeId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 每个父项下的 order 压成 0..n-1，先按现有 order，再按 nodeId。 */
export function normalizeOutline(items: readonly OutlineItem[]): OutlineItem[] {
  const groups = new Map<string | null, OutlineItem[]>();
  for (const item of items) {
    const list = groups.get(item.parentId) ?? [];
    list.push(item);
    groups.set(item.parentId, list);
  }
  const orderOf = new Map<string, number>();
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.order - b.order || compareNodeId(a.nodeId, b.nodeId));
    sorted.forEach((item, index) => {
      orderOf.set(item.nodeId, index);
    });
  }
  return items.map((item) => ({
    nodeId: item.nodeId,
    parentId: item.parentId,
    order: orderOf.get(item.nodeId) ?? 0,
  }));
}

export function initialRoots(members: { nodeId: string; createdAt: string }[]): OutlineItem[] {
  const sorted = [...members].sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return compareNodeId(a.nodeId, b.nodeId);
  });
  return sorted.map((member, index) => ({
    nodeId: member.nodeId,
    parentId: null,
    order: index,
  }));
}

function siblingsOf(items: readonly OutlineItem[], parentId: string | null): OutlineItem[] {
  return items
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.order - b.order || compareNodeId(a.nodeId, b.nodeId));
}

export function indent(items: readonly OutlineItem[], nodeId: string): OutlineItem[] {
  const currentItems = normalizeOutline(items);
  const current = currentItems.find((item) => item.nodeId === nodeId);
  if (!current) return currentItems;
  const siblings = siblingsOf(currentItems, current.parentId);
  const index = siblings.findIndex((item) => item.nodeId === nodeId);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  if (!previous) return currentItems;
  const childOrders = currentItems.filter((item) => item.parentId === previous.nodeId).map((item) => item.order);
  const nextOrder = childOrders.length === 0 ? 0 : Math.max(...childOrders) + 1;
  return normalizeOutline(
    currentItems.map((item) =>
      item.nodeId === nodeId ? { nodeId: item.nodeId, parentId: previous.nodeId, order: nextOrder } : item,
    ),
  );
}

export function outdent(items: readonly OutlineItem[], nodeId: string): OutlineItem[] {
  const currentItems = normalizeOutline(items);
  const current = currentItems.find((item) => item.nodeId === nodeId);
  if (!current || current.parentId === null) return currentItems;
  const parent = currentItems.find((item) => item.nodeId === current.parentId);
  if (!parent) return currentItems;
  const grandparentId = parent.parentId;
  return normalizeOutline(
    currentItems.map((item) => {
      if (item.nodeId === nodeId) return { nodeId: item.nodeId, parentId: grandparentId, order: parent.order + 1 };
      if (item.parentId === grandparentId && item.order > parent.order) {
        return { nodeId: item.nodeId, parentId: item.parentId, order: item.order + 1 };
      }
      return item;
    }),
  );
}

export function moveSibling(
  items: readonly OutlineItem[],
  nodeId: string,
  direction: 'up' | 'down',
): OutlineItem[] {
  const currentItems = normalizeOutline(items);
  const current = currentItems.find((item) => item.nodeId === nodeId);
  if (!current) return currentItems;
  const siblings = siblingsOf(currentItems, current.parentId);
  const index = siblings.findIndex((item) => item.nodeId === nodeId);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  const other = siblings[swapIndex];
  if (!other) return currentItems;
  return normalizeOutline(
    currentItems.map((item) => {
      if (item.nodeId === nodeId) return { nodeId: item.nodeId, parentId: item.parentId, order: other.order };
      if (item.nodeId === other.nodeId) return { nodeId: item.nodeId, parentId: item.parentId, order: current.order };
      return item;
    }),
  );
}

export function promoteOnRemove(items: readonly OutlineItem[], nodeId: string): OutlineItem[] {
  const currentItems = normalizeOutline(items);
  const current = currentItems.find((item) => item.nodeId === nodeId);
  if (!current) return currentItems;
  const children = siblingsOf(currentItems, nodeId);
  const childIndex = new Map(children.map((child, index) => [child.nodeId, index]));
  const delta = children.length - 1;
  const next: OutlineItem[] = [];
  for (const item of currentItems) {
    if (item.nodeId === nodeId) continue;
    const index = childIndex.get(item.nodeId);
    if (index !== undefined) {
      next.push({ nodeId: item.nodeId, parentId: current.parentId, order: current.order + index });
      continue;
    }
    if (item.parentId === current.parentId && item.order > current.order) {
      next.push({ nodeId: item.nodeId, parentId: item.parentId, order: item.order + delta });
      continue;
    }
    next.push(item);
  }
  return normalizeOutline(next);
}

export function hasOutlineCycle(items: readonly OutlineItem[]): boolean {
  const parentOf = new Map<string, string | null>();
  for (const item of items) {
    if (item.parentId === item.nodeId) return true;
    parentOf.set(item.nodeId, item.parentId);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  function walk(id: string): boolean {
    const mark = state.get(id);
    if (mark === 'visiting') return true;
    if (mark === 'done') return false;
    state.set(id, 'visiting');
    const parent = parentOf.get(id);
    if (parent !== undefined && parent !== null && parentOf.has(parent) && walk(parent)) return true;
    state.set(id, 'done');
    return false;
  }
  for (const item of items) {
    if (walk(item.nodeId)) return true;
  }
  return false;
}
