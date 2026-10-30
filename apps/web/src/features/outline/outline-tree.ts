import { normalizeOutline, type OutlineItem } from '@unfold/dto';
import type { MemberRestore } from './outline-history.js';

export type OutlineNodeRef = {
  id: string;
  parentId: string | null;
  outlineOrder: number;
};

export type RemovalNode = OutlineNodeRef & {
  x: number | null;
  y: number | null;
  z: number | null;
  imageWidth: number | null;
};

export type OutlineRow = {
  nodeId: string;
  depth: number;
  hasChildren: boolean;
};

export function outlineItems(nodes: readonly OutlineNodeRef[]): OutlineItem[] {
  return nodes.map((node) => ({ nodeId: node.id, parentId: node.parentId, order: node.outlineOrder }));
}

export function sameOutline(left: readonly OutlineItem[], right: readonly OutlineItem[]): boolean {
  const a = normalizeOutline(left);
  const b = normalizeOutline(right);
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((item) => [item.nodeId, item]));
  return a.every((item) => {
    const other = byId.get(item.nodeId);
    return other !== undefined && other.parentId === item.parentId && other.order === item.order;
  });
}

/** 复制展开集合并补上祖先。不加入 revealId 自己，也不删掉别的 id。 */
export function expandedWithAncestors(
  expanded: ReadonlySet<string>,
  nodes: readonly OutlineNodeRef[],
  revealId: string,
): Set<string> {
  const next = new Set(expanded);
  for (const id of ancestorIds(nodes, revealId)) next.add(id);
  return next;
}

export function ancestorIds(nodes: readonly OutlineNodeRef[], nodeId: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(nodeId)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    ids.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return ids;
}

function compareId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function visibleOutlineRows(nodes: readonly OutlineNodeRef[], expanded: ReadonlySet<string>): OutlineRow[] {
  const children = new Map<string | null, OutlineNodeRef[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.outlineOrder - b.outlineOrder || compareId(a.id, b.id));
  }
  const rows: OutlineRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      const kids = children.get(node.id) ?? [];
      rows.push({ nodeId: node.id, depth, hasChildren: kids.length > 0 });
      if (kids.length > 0 && expanded.has(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 1);
  return rows;
}

export function captureRemoval(nodes: readonly RemovalNode[], nodeId: string): MemberRestore | null {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const children = nodes
    .filter((item) => item.parentId === nodeId)
    .sort((a, b) => a.outlineOrder - b.outlineOrder || compareId(a.id, b.id))
    .map((item) => ({ nodeId: item.id, parentId: nodeId, order: item.outlineOrder }));
  return {
    nodeId,
    parentId: node.parentId,
    order: node.outlineOrder,
    placement: { x: node.x, y: node.y, z: node.z, imageWidth: node.imageWidth },
    children,
  };
}
