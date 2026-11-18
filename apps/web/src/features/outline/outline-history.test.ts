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
  layoutSide: 'left',
  children: [{ nodeId: 'c', parentId: 'b', order: 0 }],
};

describe('outline history', () => {
  it('新对象栈空', () => {
    expect(createOutlineHistory()).toEqual({ past: [], future: [] });
  });

  it('删除、正文、画布和切换不入栈', () => {
    let history = createOutlineHistory();
    history = noteOutlineSuccess(history, { type: 'delete' });
    history = noteOutlineSuccess(history, { type: 'body' });
    history = noteOutlineSuccess(history, { type: 'canvas' });
    history = noteOutlineSuccess(history, { type: 'switch' });
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
  });

  it('新建、联系和根锚点入栈并清掉重做', () => {
    const undone = commitOutlineUndo(
      noteOutlineSuccess(createOutlineHistory(), { type: 'structure', undoItems: before, redoItems: after }),
    );
    const placement = { x: 1, y: 2, z: 3, imageWidth: null };
    const children = [{ nodeId: 'c', parentId: 'b', order: 0 }];
    let history = noteOutlineSuccess(undone, { type: 'create', restore: { ...restore, placement, children } });
    placement.x = 9;
    children[0] = { nodeId: 'z', parentId: 'b', order: 1 };
    expect(history.future).toEqual([]);
    expect(history.past).toEqual([{ kind: 'create', restore }]);
    const edge = { edgeId: 'e1', fromId: 'a', toId: 'b', label: '关联' };
    history = noteOutlineSuccess(history, { type: 'edge-create', edge });
    edge.edgeId = 'mutated';
    const beforePoints = [{ id: 'a', x: 1, y: 2 }];
    const afterPoints = [{ id: 'a', x: 8, y: 9 }];
    history = noteOutlineSuccess(history, { type: 'anchors', before: beforePoints, after: afterPoints });
    beforePoints[0] = { id: 'a', x: 0, y: 0 };
    expect(history.past.at(-2)).toEqual({
      kind: 'edge-create',
      edge: { edgeId: 'e1', fromId: 'a', toId: 'b', label: '关联' },
    });
    expect(history.past.at(-1)).toEqual({
      kind: 'anchors',
      before: [{ id: 'a', x: 1, y: 2 }],
      after: [{ id: 'a', x: 8, y: 9 }],
    });
    const redone = commitOutlineRedo(commitOutlineUndo(commitOutlineUndo(history)), (entry) =>
      entry.kind === 'edge-create' ? { ...entry, edge: { ...entry.edge, edgeId: 'e2' } } : entry,
    );
    expect(redone.future.map((entry) => entry.kind)).toEqual(['anchors']);
    expect(redone.past.at(-1)).toMatchObject({ kind: 'edge-create', edge: { edgeId: 'e2' } });
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
