import type { MindmapDraftRole } from './mindmap-draft.js';
import {
  MINDMAP_LEVEL_GAP,
  MINDMAP_ORIGIN_X,
  MINDMAP_ORIGIN_Y,
  MINDMAP_ROOT_GAP,
  MINDMAP_SIBLING_GAP,
  layoutMindmap,
  type MindmapDirection,
  type MindmapNode,
} from './mindmap-layout.js';

/** 输入框占位。不是库里的点。 */
export const MINDMAP_GROW_ID = 'mindmap-grow';

export type PreviewMember = {
  id: string;
  parentId: string | null;
  order: number;
  side: 'left' | 'right' | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type GrowPreview = {
  boxes: { id: string; x: number; y: number; w: number; h: number }[];
  /** 占位的父级。插入根的父主题时为空。 */
  parentId: string | null;
  /** 插入父主题时，原来选中的点改挂到占位下面。 */
  reparentId: string | null;
};

function layoutAt(
  nodes: readonly MindmapNode[],
  anchors: ReadonlyMap<string, { x: number; y: number }>,
  folded: ReadonlySet<string>,
  direction: MindmapDirection,
  levelExtra: ReadonlyMap<string, number> | undefined,
) {
  return layoutMindmap({
    nodes,
    folded,
    direction,
    anchors,
    rootGap: MINDMAP_ROOT_GAP,
    levelGap: MINDMAP_LEVEL_GAP,
    siblingGap: MINDMAP_SIBLING_GAP,
    originX: MINDMAP_ORIGIN_X,
    originY: MINDMAP_ORIGIN_Y,
    levelExtra,
  });
}

function withDraft(
  nodes: readonly MindmapNode[],
  role: MindmapDraftRole,
  nodeId: string,
  draft: { w: number; h: number },
): { nodes: MindmapNode[]; parentId: string | null; reparentId: string | null } | null {
  const source = nodes.find((node) => node.id === nodeId);
  if (!source) return null;
  const stub = { id: MINDMAP_GROW_ID, side: null as 'left' | 'right' | null, w: draft.w, h: draft.h };
  if (role === 'child') {
    let order = 0;
    for (const node of nodes) {
      if (node.parentId === nodeId) order = Math.max(order, node.order + 1);
    }
    return {
      nodes: [...nodes, { ...stub, parentId: nodeId, order }],
      parentId: nodeId,
      reparentId: null,
    };
  }
  if (role === 'before' || role === 'after') {
    const parentId = source.parentId;
    const shifted = nodes.map((node) => {
      if (node.parentId !== parentId) return node;
      if (role === 'before' && node.order >= source.order) return { ...node, order: node.order + 1 };
      if (role === 'after' && node.order > source.order) return { ...node, order: node.order + 1 };
      return node;
    });
    return {
      nodes: [
        ...shifted,
        {
          ...stub,
          parentId,
          order: role === 'before' ? source.order : source.order + 1,
          side: source.side,
        },
      ],
      parentId,
      reparentId: null,
    };
  }
  return {
    nodes: [
      ...nodes.map((node) => (node.id === source.id ? { ...node, parentId: MINDMAP_GROW_ID, order: 0 } : node)),
      { ...stub, parentId: source.parentId, order: source.order, side: source.side },
    ],
    parentId: source.parentId,
    reparentId: source.id,
  };
}

/**
 * 按当前树的锚点，把还没写进库的子主题或同级放进 layoutMindmap。
 * 现有点用调用方给的盒子（和已经画出的布局同一套宽高）。算不出来就返回 null。
 */
export function previewMindmapGrow(input: {
  members: readonly PreviewMember[];
  folded: ReadonlySet<string>;
  direction: MindmapDirection;
  role: MindmapDraftRole;
  nodeId: string;
  draft: { w: number; h: number };
  levelExtra?: ReadonlyMap<string, number>;
}): GrowPreview | null {
  const base: MindmapNode[] = input.members.map((member) => ({
    id: member.id,
    parentId: member.parentId,
    order: member.order,
    side: member.side,
    w: member.w,
    h: member.h,
  }));
  const grown = withDraft(base, input.role, input.nodeId, input.draft);
  if (!grown) return null;
  const roots = base.filter((node) => node.parentId === null);
  if (roots.length === 0) return null;
  const zero = new Map(roots.map((root) => [root.id, { x: 0, y: 0 }]));
  const probe = layoutAt(base, zero, input.folded, input.direction, input.levelExtra);
  if (probe.length === 0) return null;
  const anchors = new Map<string, { x: number; y: number }>();
  for (const root of roots) {
    const local = probe.find((box) => box.id === root.id);
    const painted = input.members.find((member) => member.id === root.id);
    if (!local || !painted) return null;
    anchors.set(root.id, { x: painted.x - local.x, y: painted.y - local.y });
  }
  const boxes = layoutAt(grown.nodes, anchors, input.folded, input.direction, input.levelExtra);
  if (!boxes.some((box) => box.id === MINDMAP_GROW_ID)) return null;
  return { boxes, parentId: grown.parentId, reparentId: grown.reparentId };
}
