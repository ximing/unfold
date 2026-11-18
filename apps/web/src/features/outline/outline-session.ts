import { useService } from '@rabjs/react';
import { normalizeOutline, type OutlineItem } from '@unfold/dto';
import { useRef, useState } from 'react';
import { LibraryService } from '../library/library.service.js';
import { OUTLINE_CONFLICT_TEXT } from '../library/outline.js';
import {
  commitOutlineRedo,
  commitOutlineUndo,
  createOutlineHistory,
  noteOutlineSuccess,
  peekOutlineRedo,
  peekOutlineUndo,
  type AnchorPoint,
  type OutlineHistory,
  type OutlineNote,
} from './outline-history.js';
import { captureRemoval, outlineItems, sameOutline } from './outline-tree.js';

export type OutlineSavePhase = 'idle' | 'saving' | 'saved' | 'failed';

export type OutlineSession = {
  phase: OutlineSavePhase;
  conflict: boolean;
  conflictText: string;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  applyStructure: (next: OutlineItem[]) => Promise<boolean>;
  removeDirect: (nodeId: string) => Promise<boolean>;
  /** 只在已经排进 tail 的写入里调用，避免和撤销抢栈。 */
  note: (note: OutlineNote) => void;
  bindAnchorPersist: (persist: (collectionId: string) => Promise<boolean>) => void;
  track: <T>(run: () => Promise<T | null>) => Promise<T | null>;
  reload: () => Promise<void>;
};

export function useOutlineSession(collectionId: string | undefined): OutlineSession {
  const library = useService(LibraryService);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const [history, setHistory] = useState<OutlineHistory>(createOutlineHistory);
  const historyRef = useRef(history);
  const [phase, setPhase] = useState<OutlineSavePhase>('idle');
  const [conflict, setConflict] = useState(false);
  const [seen, setSeen] = useState(collectionId);
  const tail = useRef(Promise.resolve());
  const anchorPersist = useRef<(collectionId: string) => Promise<boolean>>(async () => false);
  if (seen !== collectionId) {
    const empty = createOutlineHistory();
    historyRef.current = empty;
    setSeen(collectionId);
    setHistory(empty);
    setPhase('idle');
    setConflict(false);
  } else {
    historyRef.current = history;
  }

  function remember(next: OutlineHistory) {
    historyRef.current = next;
    setHistory(next);
  }

  function note(entry: OutlineNote) {
    remember(noteOutlineSuccess(historyRef.current, entry));
  }

  function bindAnchorPersist(persist: (collectionId: string) => Promise<boolean>) {
    anchorPersist.current = persist;
  }

  async function finishLoaded(pageId: string, commit: OutlineHistory) {
    remember(commit);
    const loaded = await libraryRef.current.loadGraph(pageId);
    setPhase(loaded ? 'saved' : 'failed');
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.current.then(task, task);
    tail.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function applyStructure(next: OutlineItem[]): Promise<boolean> {
    return enqueue(async () => {
      const lib = libraryRef.current;
      if (!collectionId || lib.graphId !== collectionId) return false;
      const current = outlineItems(lib.graph.nodes);
      const normalized = normalizeOutline(next);
      if (sameOutline(current, normalized)) return true;
      setPhase('saving');
      setConflict(false);
      const result = await lib.putOutline(collectionId, lib.graph.outlineVersion, normalized);
      if (!result.ok) {
        setPhase('failed');
        setConflict(result.conflict);
        return false;
      }
      remember(noteOutlineSuccess(historyRef.current, { type: 'structure', undoItems: current, redoItems: normalized }));
      setPhase('saved');
      return true;
    });
  }

  async function undo(): Promise<void> {
    await enqueue(async () => {
      const entry = peekOutlineUndo(historyRef.current);
      const lib = libraryRef.current;
      if (!entry || !collectionId || lib.graphId !== collectionId) return;
      const pageId = collectionId;
      setPhase('saving');
      setConflict(false);
      if (entry.kind === 'structure') {
        const result = await lib.putOutline(pageId, lib.graph.outlineVersion, entry.undoItems);
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        remember(commitOutlineUndo(historyRef.current));
        setPhase('saved');
        return;
      }
      if (entry.kind === 'create') {
        const result = await lib.removeMember(pageId, entry.restore.nodeId, lib.graph.outlineVersion);
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        await finishLoaded(pageId, commitOutlineUndo(historyRef.current));
        return;
      }
      if (entry.kind === 'remove') {
        const result = await lib.restoreOutline(pageId, {
          ...entry.restore,
          expectedVersion: lib.graph.outlineVersion,
        });
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        await finishLoaded(pageId, commitOutlineUndo(historyRef.current));
        return;
      }
      if (entry.kind === 'edge-create') {
        const ok = await lib.deleteEdge(entry.edge.edgeId);
        if (!ok) {
          setPhase('failed');
          return;
        }
        await finishLoaded(pageId, commitOutlineUndo(historyRef.current));
        return;
      }
      if (entry.kind !== 'anchors') {
        setPhase('idle');
        return;
      }
      const placed = await writeAnchors(lib.graph.nodes, entry.before, (body) => lib.savePlacements(pageId, body));
      if (!placed) {
        setPhase('failed');
        return;
      }
      const laid = await anchorPersist.current(pageId);
      if (!laid) {
        setPhase('failed');
        return;
      }
      remember(commitOutlineUndo(historyRef.current));
      setPhase('saved');
    });
  }

  async function redo(): Promise<void> {
    await enqueue(async () => {
      const entry = peekOutlineRedo(historyRef.current);
      const lib = libraryRef.current;
      if (!entry || !collectionId || lib.graphId !== collectionId) return;
      const pageId = collectionId;
      setPhase('saving');
      setConflict(false);
      if (entry.kind === 'structure') {
        const result = await lib.putOutline(pageId, lib.graph.outlineVersion, entry.redoItems);
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        remember(commitOutlineRedo(historyRef.current));
        setPhase('saved');
        return;
      }
      if (entry.kind === 'create') {
        // 插入父主题也在这里重做。再 POST parent 会新建第二个点。
        const result = await lib.restoreOutline(pageId, {
          ...entry.restore,
          expectedVersion: lib.graph.outlineVersion,
        });
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        await finishLoaded(pageId, commitOutlineRedo(historyRef.current));
        return;
      }
      if (entry.kind === 'remove') {
        const result = await lib.removeMember(pageId, entry.restore.nodeId, lib.graph.outlineVersion);
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        await finishLoaded(pageId, commitOutlineRedo(historyRef.current));
        return;
      }
      if (entry.kind === 'edge-create') {
        const created = await lib.createEdge(entry.edge.fromId, entry.edge.toId, entry.edge.label);
        if (!created) {
          setPhase('failed');
          return;
        }
        await finishLoaded(
          pageId,
          commitOutlineRedo(historyRef.current, (item) =>
            item.kind === 'edge-create' ? { ...item, edge: { ...item.edge, edgeId: created.id } } : item,
          ),
        );
        return;
      }
      if (entry.kind !== 'anchors') {
        setPhase('idle');
        return;
      }
      const placed = await writeAnchors(lib.graph.nodes, entry.after, (body) => lib.savePlacements(pageId, body));
      if (!placed) {
        setPhase('failed');
        return;
      }
      const laid = await anchorPersist.current(pageId);
      if (!laid) {
        setPhase('failed');
        return;
      }
      remember(commitOutlineRedo(historyRef.current));
      setPhase('saved');
    });
  }

  async function removeDirect(nodeId: string): Promise<boolean> {
    return enqueue(async () => {
      const lib = libraryRef.current;
      if (!collectionId || lib.graphId !== collectionId) return false;
      const restore = captureRemoval(lib.graph.nodes, nodeId);
      if (!restore) return false;
      setPhase('saving');
      setConflict(false);
      const result = await lib.removeMember(collectionId, nodeId, lib.graph.outlineVersion);
      if (!result.ok) {
        setPhase('failed');
        setConflict(result.conflict);
        return false;
      }
      remember(noteOutlineSuccess(historyRef.current, { type: 'remove', restore }));
      setPhase('saved');
      return true;
    });
  }

  async function track<T>(run: () => Promise<T | null>): Promise<T | null> {
    return enqueue(async () => {
      setPhase('saving');
      setConflict(false);
      const value = await run();
      if (value) {
        setPhase('saved');
        return value;
      }
      setPhase('failed');
      return null;
    });
  }

  async function reload(): Promise<void> {
    if (!collectionId) return;
    const ok = await libraryRef.current.loadGraph(collectionId);
    if (ok) setConflict(false);
  }

  return {
    phase,
    conflict,
    conflictText: OUTLINE_CONFLICT_TEXT,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    applyStructure,
    removeDirect,
    note,
    bindAnchorPersist,
    track,
    reload,
  };
}

function writeAnchors(
  nodes: readonly { id: string; parentId: string | null; z: number | null }[],
  points: readonly AnchorPoint[],
  save: (body: { nodeId: string; x: number; y: number; z: number }[]) => Promise<boolean>,
): Promise<boolean> {
  if (points.length === 0) return Promise.resolve(false);
  const body: { nodeId: string; x: number; y: number; z: number }[] = [];
  for (const point of points) {
    const node = nodes.find((item) => item.id === point.id);
    if (!node || node.parentId !== null) return Promise.resolve(false);
    const z = typeof node.z === 'number' && Number.isFinite(node.z) ? node.z : 0;
    body.push({ nodeId: point.id, x: point.x, y: point.y, z });
  }
  return save(body);
}
