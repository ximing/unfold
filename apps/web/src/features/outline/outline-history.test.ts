import { describe, expect, it } from 'vitest';
import {
  commitOutlineRedo,
  commitOutlineUndo,
  createOutlineHistory,
  noteOutlineSuccess,
  peekOutlineUndo,
  type MemberRestore,
} from './outline-history.js';

const before = [{ nodeId: 'a', parentId: null, order: 0 }];
const after = [{ nodeId: 'a', parentId: null, order: 0 }];

const restore: MemberRestore = {
  nodeId: 'b',
  parentId: null,
  order: 1,
  placement: { x: 1, y: 2, z: 3, imageWidth: null },
  children: [{ nodeId: 'c', parentId: 'b', order: 0 }],
};

describe('outline history', () => {
  it('新对象栈空', () => {
    expect(createOutlineHistory()).toEqual({ past: [], future: [] });
  });

  it('新建不入栈', () => {
    let history = createOutlineHistory();
    history = noteOutlineSuccess(history, { type: 'create' });
    history = noteOutlineSuccess(history, { type: 'delete' });
    history = noteOutlineSuccess(history, { type: 'body' });
    history = noteOutlineSuccess(history, { type: 'canvas' });
    history = noteOutlineSuccess(history, { type: 'switch' });
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
  });

  it('成功才移动栈', () => {
    let history = noteOutlineSuccess(createOutlineHistory(), {
      type: 'structure',
      undoItems: before,
      redoItems: after,
    });
    history = noteOutlineSuccess(history, { type: 'remove', restore });
    expect(history.past).toHaveLength(2);
    expect(history.future).toEqual([]);
    const undone = commitOutlineUndo(history);
    expect(undone.past).toHaveLength(1);
    expect(undone.future).toHaveLength(1);
    expect(peekOutlineUndo(undone)?.kind).toBe('structure');
    const redone = commitOutlineRedo(undone);
    expect(redone.past).toHaveLength(2);
    expect(redone.future).toEqual([]);
    const again = noteOutlineSuccess(undone, { type: 'structure', undoItems: after, redoItems: before });
    expect(again.future).toEqual([]);
    expect(again.past).toHaveLength(2);
  });

  it('失败不消耗', () => {
    const history = noteOutlineSuccess(createOutlineHistory(), {
      type: 'structure',
      undoItems: before,
      redoItems: after,
    });
    expect(peekOutlineUndo(history)?.kind).toBe('structure');
    expect(history.past).toHaveLength(1);
    expect(history.future).toEqual([]);
    expect(commitOutlineUndo(createOutlineHistory())).toEqual({ past: [], future: [] });
  });
});
