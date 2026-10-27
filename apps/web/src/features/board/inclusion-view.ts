import type { GraphEdge, GraphInclusion, GraphNode } from '@unfold/dto';
import { INCLUSION_EMPTY_H, INCLUSION_EMPTY_W, INCLUSION_PAD, INCLUSION_TITLE } from '@unfold/dto';
import type { BoardCanvasItem, BoardCanvasLink } from './board-canvas.js';
import { NODE_W, textNodeHeight } from './board-layout.js';
import { imageFrame } from './image-frame.js';

export const INCLUSION_PREFIX = 'inclusion:';

export function inclusionItemId(childId: string): string {
  return `${INCLUSION_PREFIX}${childId}`;
}

export function inclusionChildId(itemId: string): string | null {
  if (!itemId.startsWith(INCLUSION_PREFIX)) return null;
  const id = itemId.slice(INCLUSION_PREFIX.length);
  return id.length === 0 ? null : id;
}

export type InclusionGroup = {
  childId: string;
  title: string;
  labels: string[];
  anchorX: number;
  anchorY: number;
  collapsed: boolean;
  memberIds: string[];
};

export type ProjectedCollection = {
  items: BoardCanvasItem[];
  links: BoardCanvasLink[];
  groups: InclusionGroup[];
};

type Box = { x: number; y: number; w: number; h: number };

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function worldBox(node: GraphNode, anchorX: number, anchorY: number): Box | null {
  if (!finite(node.x) || !finite(node.y)) return null;
  const x = node.x + anchorX;
  const y = node.y + anchorY;
  if (node.kind === 'image') {
    const frame = imageFrame(node.imageWidth, 1);
    return { x, y, w: frame.w, h: frame.h };
  }
  return { x, y, w: NODE_W, h: textNodeHeight(node.description) };
}

/** 收起后那个点的左上角，和展开时边框的左上角对齐。 */
export function collapsedOrigin(inclusion: GraphInclusion): { x: number; y: number } {
  const boxes = inclusion.nodes
    .map((node) => worldBox(node, inclusion.x, inclusion.y))
    .filter((box): box is Box => box !== null);
  if (boxes.length === 0) return { x: inclusion.x, y: inclusion.y };
  return {
    x: Math.min(...boxes.map((box) => box.x)) - INCLUSION_PAD,
    y: Math.min(...boxes.map((box) => box.y)) - INCLUSION_PAD - INCLUSION_TITLE,
  };
}

/** 展开的边框。成员盒子应已经包含拖动中的位移；没有成员时用锚点。 */
export function inclusionFrameRect(
  group: InclusionGroup,
  boxOf: ReadonlyMap<string, Box>,
  shift?: { childId: string; dx: number; dy: number } | null,
): Box | null {
  if (group.collapsed) return null;
  const found: Box[] = [];
  for (const id of group.memberIds) {
    const box = boxOf.get(id);
    if (box) found.push(box);
  }
  if (found.length === 0) {
    const dx = shift?.childId === group.childId ? shift.dx : 0;
    const dy = shift?.childId === group.childId ? shift.dy : 0;
    return { x: group.anchorX + dx, y: group.anchorY + dy, w: INCLUSION_EMPTY_W, h: INCLUSION_EMPTY_H };
  }
  const minX = Math.min(...found.map((box) => box.x));
  const minY = Math.min(...found.map((box) => box.y));
  const maxX = Math.max(...found.map((box) => box.x + box.w));
  const maxY = Math.max(...found.map((box) => box.y + box.h));
  return {
    x: minX - INCLUSION_PAD,
    y: minY - INCLUSION_PAD - INCLUSION_TITLE,
    w: maxX - minX + INCLUSION_PAD * 2,
    h: maxY - minY + INCLUSION_PAD * 2 + INCLUSION_TITLE,
  };
}

function toItem(node: GraphNode, extra: Partial<BoardCanvasItem> = {}): BoardCanvasItem {
  return {
    id: node.id,
    label: node.name,
    description: node.description,
    count: node.cardCount,
    types: node.cardTypes,
    x: node.x,
    y: node.y,
    z: node.z,
    kind: node.kind,
    assetId: node.assetId,
    imageWidth: node.imageWidth,
    ...extra,
  };
}

function toLink(edge: GraphEdge, fromId: string, toId: string): BoardCanvasLink {
  return { id: edge.id, fromId, toId, label: edge.label, count: edge.cardCount };
}

function remember(visualOf: Map<string, string>, nodeId: string, visualId: string) {
  if (!visualOf.has(nodeId)) visualOf.set(nodeId, visualId);
}

/** 把子集合投影到父合集的世界坐标。已经在父合集里的点不在边框里再画。 */
export function projectCollection(input: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  bridges: readonly GraphEdge[];
  inclusions: readonly GraphInclusion[];
}): ProjectedCollection {
  const visualOf = new Map<string, string>();
  for (const node of input.nodes) visualOf.set(node.id, node.id);
  const items: BoardCanvasItem[] = input.nodes.map((node) => toItem(node));
  const groups: InclusionGroup[] = [];

  for (const inclusion of input.inclusions) {
    const fresh = inclusion.nodes.filter((node) => !visualOf.has(node.id));
    if (inclusion.collapsed) {
      const origin = collapsedOrigin(inclusion);
      const itemId = inclusionItemId(inclusion.childId);
      items.push({
        id: itemId,
        label: inclusion.title,
        description: `子集合 · ${inclusion.nodes.length} 个点`,
        x: origin.x,
        y: origin.y,
        z: 0,
        face: 'inclusion',
        groupId: inclusion.childId,
      });
      for (const node of inclusion.nodes) remember(visualOf, node.id, itemId);
      groups.push({
        childId: inclusion.childId,
        title: inclusion.title,
        labels: inclusion.labels,
        anchorX: inclusion.x,
        anchorY: inclusion.y,
        collapsed: true,
        memberIds: [],
      });
      continue;
    }

    const memberIds: string[] = [];
    for (const node of fresh) {
      visualOf.set(node.id, node.id);
      memberIds.push(node.id);
      items.push(
        toItem(node, {
          x: finite(node.x) ? node.x + inclusion.x : node.x,
          y: finite(node.y) ? node.y + inclusion.y : node.y,
          groupId: inclusion.childId,
        }),
      );
    }
    groups.push({
      childId: inclusion.childId,
      title: inclusion.title,
      labels: inclusion.labels,
      anchorX: inclusion.x,
      anchorY: inclusion.y,
      collapsed: false,
      memberIds,
    });
  }

  const links: BoardCanvasLink[] = [];
  const push = (edge: GraphEdge) => {
    const from = visualOf.get(edge.fromId);
    const to = visualOf.get(edge.toId);
    if (!from || !to || from === to) return;
    links.push(toLink(edge, from, to));
  };
  for (const edge of input.edges) push(edge);
  for (const inclusion of input.inclusions) {
    if (inclusion.collapsed) continue;
    // 内部边的两端都要落在这块边框里。已经画在父合集上的点不算。
    const members = new Set(groups.find((group) => group.childId === inclusion.childId)?.memberIds);
    for (const edge of inclusion.edges) {
      if (!members.has(edge.fromId) || !members.has(edge.toId)) continue;
      push(edge);
    }
  }
  for (const edge of input.bridges) push(edge);
  return { items, links, groups };
}
