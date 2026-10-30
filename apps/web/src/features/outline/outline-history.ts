import type { OutlineItem } from '@unfold/dto';

export type OutlinePlacement = {
  x: number | null;
  y: number | null;
  z: number | null;
  imageWidth: number | null;
};

/** 移出的反向请求。expectedVersion 在发出时再填当前版本。 */
export type MemberRestore = {
  nodeId: string;
  parentId: string | null;
  order: number;
  placement: OutlinePlacement;
  children: OutlineItem[];
};

export type OutlineRecord =
  | { kind: 'structure'; undoItems: OutlineItem[]; redoItems: OutlineItem[] }
  | { kind: 'remove'; restore: MemberRestore };

export type OutlineHistory = {
  past: OutlineRecord[];
  future: OutlineRecord[];
};

export type OutlineNote =
  | { type: 'structure'; undoItems: OutlineItem[]; redoItems: OutlineItem[] }
  | { type: 'remove'; restore: MemberRestore }
  | { type: 'create' }
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

/** 只有改父级、同级排序、移出会入栈，并清掉重做。新建等动作原样返回。 */
export function noteOutlineSuccess(history: OutlineHistory, note: OutlineNote): OutlineHistory {
  if (note.type === 'structure') {
    return {
      past: [...history.past, { kind: 'structure', undoItems: copyItems(note.undoItems), redoItems: copyItems(note.redoItems) }],
      future: [],
    };
  }
  if (note.type === 'remove') {
    return {
      past: [
        ...history.past,
        {
          kind: 'remove',
          restore: {
            ...note.restore,
            placement: { ...note.restore.placement },
            children: copyItems(note.restore.children),
          },
        },
      ],
      future: [],
    };
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

export function commitOutlineRedo(history: OutlineHistory): OutlineHistory {
  const entry = history.future.at(-1);
  if (!entry) return history;
  return { past: [...history.past, entry], future: history.future.slice(0, -1) };
}
