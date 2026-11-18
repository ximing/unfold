/** 脑图浮层落点和结构键。朝向固定向右，不读账号的 grow。 */

export const MINDMAP_LEVEL_GAP = 72;
export const MINDMAP_SIBLING_GAP = 16;
export const MINDMAP_DRAFT_H = 34;

export type MindmapBox = { x: number; y: number; w: number; h: number };

export type MindmapDraftRole = 'child' | 'after' | 'before' | 'parent';

/** 浮层左上角。draft.h 用输入框高。父主题没有父盒子时放在左侧。 */
export function mindmapDraftAt(
  role: MindmapDraftRole,
  anchor: MindmapBox,
  draft: { w: number; h: number },
  parent: MindmapBox | null,
): { x: number; y: number } {
  if (role === 'child') {
    return {
      x: anchor.x + anchor.w + MINDMAP_LEVEL_GAP,
      y: anchor.y + (anchor.h - draft.h) / 2,
    };
  }
  if (role === 'after') {
    return { x: anchor.x, y: anchor.y + anchor.h + MINDMAP_SIBLING_GAP };
  }
  if (role === 'before') {
    return { x: anchor.x, y: anchor.y - MINDMAP_SIBLING_GAP - draft.h };
  }
  if (parent) {
    const midX = (anchor.x + anchor.w / 2 + parent.x + parent.w / 2) / 2;
    const midY = (anchor.y + anchor.h / 2 + parent.y + parent.h / 2) / 2;
    return { x: midX - draft.w / 2, y: midY - draft.h / 2 };
  }
  return {
    x: anchor.x - MINDMAP_LEVEL_GAP - draft.w,
    y: anchor.y + (anchor.h - draft.h) / 2,
  };
}

export type MindmapNode = { id: string; parentId: string | null; outlineOrder: number };

function byOutline(left: MindmapNode, right: MindmapNode): number {
  if (left.outlineOrder !== right.outlineOrder) return left.outlineOrder - right.outlineOrder;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/** 只在传入的直接成员里走。向右是第一个子项，向左是父项，上下是同父级相邻项。 */
export function mindmapNeighbor(
  nodes: readonly MindmapNode[],
  selectedId: string,
  direction: 'up' | 'down' | 'left' | 'right',
): string | null {
  const selected = nodes.find((node) => node.id === selectedId);
  if (!selected) return null;
  if (direction === 'left') {
    if (!selected.parentId) return null;
    return nodes.some((node) => node.id === selected.parentId) ? selected.parentId : null;
  }
  if (direction === 'right') {
    const children = nodes.filter((node) => node.parentId === selectedId).sort(byOutline);
    return children[0]?.id ?? null;
  }
  const siblings = nodes.filter((node) => node.parentId === selected.parentId).sort(byOutline);
  const index = siblings.findIndex((node) => node.id === selectedId);
  const next = direction === 'up' ? siblings[index - 1] : siblings[index + 1];
  return next?.id ?? null;
}

export type MindmapSelection = 'none' | 'multi' | 'edge' | 'chip' | 'uploading' | 'projected' | 'member';

export type MindmapItemRef = {
  id: string;
  groupId?: string | null;
  face?: 'inclusion';
  uploading?: boolean;
};

/** 只有没有 groupId 的直接成员走树。投影点、芯片、上传中分开。 */
export function mindmapSelectionOf(input: {
  selectedIds: readonly string[];
  selectedId: string | null;
  edge: boolean;
  item: MindmapItemRef | null;
}): MindmapSelection {
  if (input.selectedIds.length > 1) return 'multi';
  if (input.edge) return 'edge';
  const id = input.selectedId;
  if (!id) return 'none';
  if (input.item?.uploading || id.startsWith('uploading:')) return 'uploading';
  if (input.item?.face === 'inclusion' || id.startsWith('inclusion:')) return 'chip';
  if (input.item?.groupId != null) return 'projected';
  if (!input.item) return 'none';
  return 'member';
}

export type MindmapKeyInput = {
  toolsOn: boolean;
  field: boolean;
  blocked: boolean;
  composing: boolean;
  repeat: boolean;
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  selection: MindmapSelection;
};

export type MindmapKeyAction =
  | { type: 'draft'; role: MindmapDraftRole }
  | { type: 'move-sibling'; direction: 'up' | 'down' }
  | { type: 'navigate'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'rename' }
  | { type: 'suppress' };

/** null 表示不拦截。suppress 只 preventDefault，不改结构。 */
export function mindmapKeyAction(input: MindmapKeyInput): MindmapKeyAction | null {
  if (!input.toolsOn || input.field || input.blocked || input.composing) return null;

  const unmodified = !input.metaKey && !input.ctrlKey && !input.altKey;
  const commandEnter =
    input.key === 'Enter' && (input.metaKey || input.ctrlKey) && !input.shiftKey && !input.altKey;
  const typedEnter = input.key === 'Enter' && unmodified;
  const typedTab = input.key === 'Tab' && unmodified && !input.shiftKey;
  const altSibling =
    input.altKey &&
    !input.metaKey &&
    !input.ctrlKey &&
    !input.shiftKey &&
    (input.key === 'ArrowUp' || input.key === 'ArrowDown');
  const typedArrow =
    unmodified &&
    !input.shiftKey &&
    (input.key === 'ArrowUp' || input.key === 'ArrowDown' || input.key === 'ArrowLeft' || input.key === 'ArrowRight');
  const rename = input.key === 'F2' && unmodified && !input.shiftKey;
  if (!commandEnter && !typedEnter && !typedTab && !altSibling && !typedArrow && !rename) return null;

  if (input.selection === 'multi') {
    if (typedTab || typedEnter || commandEnter || altSibling || typedArrow) return { type: 'suppress' };
    return null;
  }
  if (input.selection === 'member') {
    if (input.repeat && (typedTab || typedEnter || commandEnter || altSibling)) return { type: 'suppress' };
    if (typedTab) return { type: 'draft', role: 'child' };
    if (typedEnter && input.shiftKey) return { type: 'draft', role: 'before' };
    if (typedEnter) return { type: 'draft', role: 'after' };
    if (commandEnter) return { type: 'draft', role: 'parent' };
    if (altSibling) return { type: 'move-sibling', direction: input.key === 'ArrowUp' ? 'up' : 'down' };
    if (typedArrow) {
      const direction =
        input.key === 'ArrowUp' ? 'up' : input.key === 'ArrowDown' ? 'down' : input.key === 'ArrowLeft' ? 'left' : 'right';
      return { type: 'navigate', direction };
    }
    if (rename) return { type: 'rename' };
    return null;
  }
  if (rename && input.selection === 'projected') return { type: 'rename' };
  if (typedArrow || input.selection === 'none' || input.selection === 'edge') return null;
  if (input.selection === 'chip' && typedEnter) return null;
  if (typedTab || typedEnter || commandEnter || altSibling) return { type: 'suppress' };
  return null;
}
