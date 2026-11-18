import type { OutlineItem } from '@unfold/dto';

export type OutlinePlacement = {
  x: number | null;
  y: number | null;
  z: number | null;
  imageWidth: number | null;
};

/** 移出或新建的反向请求。expectedVersion 在发出时再填当前版本。 */
export type MemberRestore = {
  nodeId: string;
  parentId: string | null;
  order: number;
  placement: OutlinePlacement;
  children: OutlineItem[];
  layoutSide: 'left' | 'right' | null;
};

export type AnchorPoint = {
  id: string;
  x: number;
  y: number;
};

export type EdgeCreateRecord = {
  edgeId: string;
  fromId: string;
  toId: string;
  label: string;
};

export type OutlineRecord =
  | { kind: 'structure'; undoItems: OutlineItem[]; redoItems: OutlineItem[] }
  | { kind: 'remove'; restore: MemberRestore }
  | { kind: 'create'; restore: MemberRestore }
  | { kind: 'edge-create'; edge: EdgeCreateRecord }
  | { kind: 'anchors'; before: AnchorPoint[]; after: AnchorPoint[] };

export type OutlineHistory = {
  past: OutlineRecord[];
  future: OutlineRecord[];
};

export type OutlineNote =
  | { type: 'structure'; undoItems: OutlineItem[]; redoItems: OutlineItem[] }
  | { type: 'remove'; restore: MemberRestore }
  | { type: 'create'; restore: MemberRestore }
  | { type: 'edge-create'; edge: EdgeCreateRecord }
  | { type: 'anchors'; before: AnchorPoint[]; after: AnchorPoint[] }
  | { type: 'delete' }
  | { type: 'body' }
  | { type: 'canvas' }
  | { type: 'switch' };

export function createOutlineHistory(): OutlineHistory {
  return { past: [], future: [] };
}

function copyItems(items: readonly OutlineItem[]): OutlineItem[] {
  return items.map((item) => ({ nodeId: item.nodeId, parentId: item.parentId, order: item.order }));
}

function copyRestore(restore: MemberRestore): MemberRestore {
  return {
    ...restore,
    placement: { ...restore.placement },
    children: copyItems(restore.children),
  };
}

function copyAnchors(points: readonly AnchorPoint[]): AnchorPoint[] {
  return points.map((point) => ({ id: point.id, x: point.x, y: point.y }));
}

function pushRecord(history: OutlineHistory, record: OutlineRecord): OutlineHistory {
  return { past: [...history.past, record], future: [] };
}

/** 改父级、同级排序、移出、新建、新建联系和根锚点入栈，并清掉重做。其余原样返回。 */
export function noteOutlineSuccess(history: OutlineHistory, note: OutlineNote): OutlineHistory {
  if (note.type === 'structure') {
    return pushRecord(history, {
      kind: 'structure',
      undoItems: copyItems(note.undoItems),
      redoItems: copyItems(note.redoItems),
    });
  }
  if (note.type === 'remove') return pushRecord(history, { kind: 'remove', restore: copyRestore(note.restore) });
  if (note.type === 'create') return pushRecord(history, { kind: 'create', restore: copyRestore(note.restore) });
  if (note.type === 'edge-create') return pushRecord(history, { kind: 'edge-create', edge: { ...note.edge } });
  if (note.type === 'anchors') {
    return pushRecord(history, { kind: 'anchors', before: copyAnchors(note.before), after: copyAnchors(note.after) });
  }
  return history;
}

export function peekOutlineUndo(history: OutlineHistory): OutlineRecord | null {
  return history.past.at(-1) ?? null;
}

export function peekOutlineRedo(history: OutlineHistory): OutlineRecord | null {
  return history.future.at(-1) ?? null;
}

/** 请求成功后才调用。失败时不要调用，栈保持原样。 */
export function commitOutlineUndo(history: OutlineHistory): OutlineHistory {
  const entry = history.past.at(-1);
  if (!entry) return history;
  return { past: history.past.slice(0, -1), future: [...history.future, entry] };
}

export function commitOutlineRedo(
  history: OutlineHistory,
  revise?: (entry: OutlineRecord) => OutlineRecord,
): OutlineHistory {
  const entry = history.future.at(-1);
  if (!entry) return history;
  return { past: [...history.past, revise ? revise(entry) : entry], future: history.future.slice(0, -1) };
}
