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
  type OutlineHistory,
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
      setPhase('saving');
      setConflict(false);
      if (entry.kind === 'structure') {
        const result = await lib.putOutline(collectionId, lib.graph.outlineVersion, entry.undoItems);
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        remember(commitOutlineUndo(historyRef.current));
        setPhase('saved');
        return;
      }
      const result = await lib.restoreOutline(collectionId, {
        ...entry.restore,
        expectedVersion: lib.graph.outlineVersion,
      });
      if (!result.ok) {
        setPhase('failed');
        setConflict(result.conflict);
        return;
      }
      remember(commitOutlineUndo(historyRef.current));
      const loaded = await lib.loadGraph(collectionId);
      setPhase(loaded ? 'saved' : 'failed');
    });
  }

  async function redo(): Promise<void> {
    await enqueue(async () => {
      const entry = peekOutlineRedo(historyRef.current);
      const lib = libraryRef.current;
      if (!entry || !collectionId || lib.graphId !== collectionId) return;
      setPhase('saving');
      setConflict(false);
      if (entry.kind === 'structure') {
        const result = await lib.putOutline(collectionId, lib.graph.outlineVersion, entry.redoItems);
        if (!result.ok) {
          setPhase('failed');
          setConflict(result.conflict);
          return;
        }
        remember(commitOutlineRedo(historyRef.current));
        setPhase('saved');
        return;
      }
      const result = await lib.removeMember(collectionId, entry.restore.nodeId, lib.graph.outlineVersion);
      if (!result.ok) {
        setPhase('failed');
        setConflict(result.conflict);
        return;
      }
      remember(commitOutlineRedo(historyRef.current));
      const loaded = await lib.loadGraph(collectionId);
      setPhase(loaded ? 'saved' : 'failed');
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
    track,
    reload,
  };
}
