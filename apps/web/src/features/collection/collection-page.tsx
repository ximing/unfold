import { observer, useService } from '@rabjs/react';
import {
  defaultEdgeAppearance,
  hasOutlineCycle,
  moveSibling,
  type CreateNodeResult,
  type GraphInclusion,
  type GraphNode,
  type LayoutDirection,
} from '@unfold/dto';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BoardCanvas } from '../board/board-canvas.js';
import { imageDropSpots, imageFileIssue } from '../board/image-intake.js';
import { NODE_H, NODE_W, isFiniteNumber, layoutBoard, nextPlacementZ, textNodeHeight } from '../board/board-layout.js';
import { imageFrame } from '../board/image-frame.js';
import { collapsedOrigin, inclusionChildId, inclusionFrameRect, inclusionItemId, projectCollection } from '../board/inclusion-view.js';
import { branchFold, directChildCount, foldSide, linksForFold, toggleFold } from '../board/board-fold.js';
import {
  MINDMAP_LEVEL_GAP,
  MINDMAP_ORIGIN_X,
  MINDMAP_ORIGIN_Y,
  MINDMAP_ROOT_GAP,
  MINDMAP_SIBLING_GAP,
  layoutMindmap,
  separateFromObstacles,
} from '../board/mindmap-layout.js';
import type { MindmapBox, ObstacleRect } from '../board/mindmap-layout.js';
import { branchLevelExtra } from '../board/label.js';
import { anchorForRootDrop, anchorFromDrop, mindmapPlacements, treeAnchor } from '../board/mindmap-place.js';
import { snapPoint } from '../board/snap.js';
import { readCollectionView, writeCollectionView, type CollectionViewMode } from '../outline/collection-view.js';
import { CreateNoticeBanner, OutlineView, type CreateNotice } from '../outline/outline-view.js';
import { useOutlineSession } from '../outline/outline-session.js';
import { captureRemoval } from '../outline/outline-tree.js';
import { InclusionDialog } from './inclusion-dialog.js';
import { apiSend, errorMessage } from '../library/api.js';
import { LibraryService } from '../library/library.service.js';
import { SaveService } from '../save/save.service.js';
import { SessionService } from '../session/session.service.js';
import { USegmented } from '../../shared/ui/segmented/segmented.js';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { EdgePanel } from './edge-panel.js';
import { NodePanel } from './node-panel.js';
import { NodePeek } from './node-peek.js';

type Selection = { kind: 'node' | 'edge' | 'inclusion'; id: string } | null;

type UploadSpot = { id: string; label: string; x: number; y: number; z: number; homeId: string };

type MindmapPersist = {
  anchors?: ReadonlyMap<string, { x: number; y: number }>;
  folded?: ReadonlySet<string>;
  separate?: boolean;
};

function outlineMoved(
  before: readonly { nodeId: string; parentId: string | null; order: number }[],
  after: readonly { nodeId: string; parentId: string | null; order: number }[],
  nodeId: string,
): boolean {
  const indexOf = (items: readonly { nodeId: string; parentId: string | null; order: number }[]) => {
    const current = items.find((item) => item.nodeId === nodeId);
    if (!current) return -1;
    return items
      .filter((item) => item.parentId === current.parentId)
      .sort(
        (left, right) => left.order - right.order || (left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0),
      )
      .findIndex((item) => item.nodeId === nodeId);
  };
  return indexOf(before) !== indexOf(after);
}

export const CollectionPage = observer(function CollectionPage() {
  const library = useService(LibraryService);
  const session = useService(SessionService);
  const save = useService(SaveService);
  const { id } = useParams();
  const [params] = useSearchParams();
  const nodeQuery = params.get('node') ?? '';
  const edgeQuery = params.get('edge') ?? '';
  const cardQuery = params.get('card') ?? '';
  const outlineSession = useOutlineSession(id);
  const outlineRef = useRef(outlineSession);
  outlineRef.current = outlineSession;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  /** 右侧详情面板的内容。单击只改 selection（画布高亮），再点一次或右键「查看详情」才打开 */
  const [detail, setDetail] = useState<Selection>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [mode, setMode] = useState<CollectionViewMode>(() => (id ? readCollectionView(id) : 'board'));
  const [entry, setEntry] = useState<'open' | 'switch'>('open');
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const [memberAsk, setMemberAsk] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<CreateNotice | null>(null);
  const [structure, setStructure] = useState(false);
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const [seenId, setSeenId] = useState(id);
  const [boardFold, setBoardFold] = useState<Set<string>>(() => (id ? readBoardFold(id) : new Set()));
  const [uploads, setUploads] = useState<UploadSpot[]>([]);
  const [insertAt, setInsertAt] = useState<{ x: number; y: number } | null>(null);
  const uploadsRef = useRef<UploadSpot[]>([]);
  const pageIdRef = useRef(id);
  const layoutEpoch = useRef(0);
  const modeRef = useRef(mode);
  const nodeIdsRef = useRef(nodeIds);
  const foldRef = useRef(boardFold);
  const commitFoldRef = useRef<(next: readonly string[]) => void>(() => undefined);
  const intakeQueue = useRef(Promise.resolve());
  const placeTried = useRef(new Set<string>());
  const mindmapBoot = useRef<string | null>(null);
  const persistRef = useRef<(pageId: string, request?: MindmapPersist) => Promise<boolean>>(async () => false);
  const removeToken = useRef(0);
  const [removeAsk, setRemoveAsk] = useState<{ kind: 'node' | 'edge'; id: string; token: number } | null>(null);
  pageIdRef.current = id;
  modeRef.current = mode;
  nodeIdsRef.current = nodeIds;
  if (id !== seenId) {
    const nextFold = id ? readBoardFold(id) : new Set<string>();
    foldRef.current = nextFold;
    setBoardFold(nextFold);
    setSeenId(id);
    setReady(false);
    setMissing(false);
    setSelection(null);
    setDetail(null);
    setSelectedId(null);
    setNodeIds([]);
    setMode(id ? readCollectionView(id) : 'board');
    setEntry('open');
    setFocus(null);
    setMemberAsk(null);
    setCreateNotice(null);
    setStructure(false);
    setAdding(undefined);
    setInsertAt(null);
    if (uploadsRef.current.length > 0) {
      uploadsRef.current = [];
      setUploads([]);
    }
  } else {
    foldRef.current = boardFold;
  }
  commitFoldRef.current = (next) => {
    const pageId = pageIdRef.current;
    if (!pageId) return;
    const folded = new Set(next);
    foldRef.current = folded;
    writeBoardFold(pageId, next);
    setBoardFold(folded);
  };

  async function persistMindmap(pageId: string, request?: MindmapPersist): Promise<boolean> {
    if (pageIdRef.current !== pageId || library.graphId !== pageId) return false;
    const nodes = library.graph.nodes;
    if (nodes.length === 0) return true;
    const folded = request?.folded ?? readBoardFold(pageId);
    const anchors = request?.anchors ?? storedAnchors(nodes);
    let boxes = layoutDirect(nodes, library.graph.layoutDirection, anchors, folded, library.graph.edges);
    if (request?.separate) {
      boxes = separateFromObstacles(
        boxes,
        inclusionObstacles(library.graph.inclusions, new Set(nodes.map((node) => node.id))),
      );
    }
    if (boxes.length === 0) return false;
    const writes = mindmapPlacements(
      nodes.map((node) => ({ id: node.id, parentId: node.parentId, x: node.x, y: node.y, z: node.z })),
      boxes,
    );
    if (writes.length === 0) return true;
    return library.savePlacements(pageId, writes);
  }
  persistRef.current = persistMindmap;
  outlineSession.bindAnchorPersist((pageId) => persistRef.current(pageId));

  async function bootMindmap(pageId: string): Promise<{ ok: true } | null> {
    if (pageIdRef.current !== pageId) return { ok: true };
    const adopted = await library.adoptMindmap(pageId);
    if (pageIdRef.current !== pageId) return { ok: true };
    if (!adopted) return null;
    if (adopted.mindmapAnchored) {
      if (library.graphId === pageId) await library.loadGraph(pageId);
      return { ok: true };
    }
    const saved = await persistMindmap(pageId, { anchors: new Map(), folded: new Set(), separate: true });
    if (pageIdRef.current !== pageId) return { ok: true };
    if (!saved) return null;
    const first = await library.commitMindmap(pageId);
    if (first === 'ok') return { ok: true };
    if (first !== 'conflict' || pageIdRef.current !== pageId) return null;
    const again = await library.adoptMindmap(pageId);
    if (pageIdRef.current !== pageId) return { ok: true };
    if (!again) return null;
    if (again.mindmapAnchored) {
      if (library.graphId === pageId) await library.loadGraph(pageId);
      return { ok: true };
    }
    const second = await library.commitMindmap(pageId);
    return second === 'ok' ? { ok: true } : null;
  }

  function trackPersist(pageId: string, request?: MindmapPersist): Promise<boolean> {
    return outlineRef.current
      .track(async () => {
        const ok = await persistRef.current(pageId, request);
        return ok ? { ok: true as const } : null;
      })
      .then((value) => value !== null);
  }

  function trackDrop(
    pageId: string,
    drop: { rootId: string; x: number; y: number } | null,
    recordAnchor = false,
  ): Promise<boolean> {
    return outlineRef.current
      .track(async () => {
        const lib = libraryRef.current;
        if (lib.graphId !== pageId) return null;
        let request: MindmapPersist | undefined;
        let anchorNote: { before: { id: string; x: number; y: number }; after: { id: string; x: number; y: number } } | null =
          null;
        if (drop) {
          const nodes = lib.graph.nodes;
          const folded = readBoardFold(pageId);
          const anchors = storedAnchors(nodes);
          const stored = anchors.get(drop.rootId);
          let before = stored ?? null;
          if (!before) {
            const laid = layoutDirect(nodes, lib.graph.layoutDirection, anchors, folded, lib.graph.edges);
            const box = laid.find((item) => item.id === drop.rootId);
            if (box) before = { x: box.x, y: box.y };
          }
          const trial = new Map(anchors);
          trial.set(drop.rootId, { x: drop.x, y: drop.y });
          const boxes = layoutDirect(nodes, lib.graph.layoutDirection, trial, folded, lib.graph.edges);
          const rootBox = boxes.find((box) => box.id === drop.rootId);
          if (!rootBox) return null;
          const next = anchorFromDrop({ x: drop.x, y: drop.y }, rootBox, { x: drop.x, y: drop.y });
          anchors.set(drop.rootId, next);
          request = { anchors };
          if (recordAnchor && before && (before.x !== next.x || before.y !== next.y)) {
            anchorNote = {
              before: { id: drop.rootId, x: before.x, y: before.y },
              after: { id: drop.rootId, x: next.x, y: next.y },
            };
          }
        }
        const ok = await persistRef.current(pageId, request);
        if (!ok) return null;
        if (anchorNote) {
          outlineRef.current.note({ type: 'anchors', before: [anchorNote.before], after: [anchorNote.after] });
        }
        return { ok: true as const };
      })
      .then((value) => value !== null);
  }

  function trackShift(pageId: string, moves: { id: string; x: number; y: number }[]): Promise<boolean> {
    return outlineRef.current
      .track(async () => {
        const lib = libraryRef.current;
        if (lib.graphId !== pageId) return null;
        const nodes = lib.graph.nodes;
        const folded = readBoardFold(pageId);
        const anchors = storedAnchors(nodes);
        const boxes = layoutDirect(nodes, lib.graph.layoutDirection, anchors, folded, lib.graph.edges);
        const first = moves[0];
        const visual = first ? boxes.find((box) => box.id === first.id) : undefined;
        if (!first || !visual) return null;
        const dx = first.x - visual.x;
        const dy = first.y - visual.y;
        const shifts: { id: string; x: number; y: number; nextX: number; nextY: number }[] = [];
        for (const move of moves) {
          const node = nodes.find((item) => item.id === move.id);
          const base =
            node && isFiniteNumber(node.x) && isFiniteNumber(node.y)
              ? { x: node.x, y: node.y }
              : treeAnchor(move.id, nodes, boxes);
          if (!base) continue;
          const nextX = base.x + dx;
          const nextY = base.y + dy;
          anchors.set(move.id, { x: nextX, y: nextY });
          if (nextX !== base.x || nextY !== base.y) shifts.push({ id: move.id, x: base.x, y: base.y, nextX, nextY });
        }
        const ok = await persistRef.current(pageId, { anchors });
        if (!ok) return null;
        if (shifts.length > 0) {
          outlineRef.current.note({
            type: 'anchors',
            before: shifts.map((item) => ({ id: item.id, x: item.x, y: item.y })),
            after: shifts.map((item) => ({ id: item.id, x: item.nextX, y: item.nextY })),
          });
        }
        return { ok: true as const };
      })
      .then((value) => value !== null);
  }

  function runHistory(redo: boolean) {
    const current = outlineRef.current;
    if (current.phase === 'saving') return;
    const pageId = pageIdRef.current;
    const lib = libraryRef.current;
    const version = pageId && lib.graphId === pageId ? lib.graph.outlineVersion : null;
    void (async () => {
      if (redo) await current.redo();
      else await current.undo();
      if (!pageId || version === null || pageIdRef.current !== pageId) return;
      if (lib.graphId !== pageId || lib.graph.outlineVersion === version) return;
      await trackPersist(pageId);
    })();
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setReady(false);
    setMissing(false);
    setSelection(null);
    setDetail(null);
    void (async () => {
      const ok = await library.loadGraph(id);
      if (!alive) return;
      setReady(true);
      if (!ok) {
        setMissing(true);
        return;
      }
      if (nodeQuery !== '') {
        locateNode(nodeQuery);
        setDetail({ kind: 'node', id: nodeQuery });
        void library.loadNode(nodeQuery);
      } else if (edgeQuery !== '') {
        setNodeIds([]);
        setSelection({ kind: 'edge', id: edgeQuery });
        setDetail({ kind: 'edge', id: edgeQuery });
        void library.loadEdge(edgeQuery);
      }
    })();
    return () => {
      alive = false;
    };
  }, [edgeQuery, id, library, nodeQuery]);

  useEffect(() => {
    if (!ready || !id || library.graphId !== id) return;
    for (const inclusion of library.graph.inclusions) {
      if (inclusion.collapsed) continue;
      if (inclusion.nodes.length === 0 || inclusion.nodes.some((node) => isFiniteNumber(node.x))) continue;
      const key = `${id}:inc:${inclusion.childId}`;
      if (placeTried.current.has(key)) continue;
      placeTried.current.add(key);
      const boxes = layoutBoard(
        inclusion.nodes.map((node) => ({ id: node.id })),
        inclusion.edges.map((edge) => ({ fromId: edge.fromId, toId: edge.toId })),
      );
      void library.savePlacements(
        inclusion.childId,
        boxes.map((box, index) => ({ nodeId: box.id, x: box.x, y: box.y, z: index })),
      );
    }
    if (library.graph.mindmapAnchored || mindmapBoot.current === id) return;
    mindmapBoot.current = id;
    const pageId = id;
    void outlineRef.current.track(() => bootMindmap(pageId));
  }, [ready, id, library, library.graph, library.graphId]);

  useEffect(() => {
    if (!id) {
      library.watchView(null);
      return;
    }
    library.watchView({
      kind: 'collection',
      id,
      nodeId: selection?.kind === 'node' ? selection.id : null,
      edgeId: selection?.kind === 'edge' ? selection.id : null,
    });
    return () => library.watchView(null);
  }, [id, library, selection]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('.modal-wrap, .overlay, .addm-overlay')) return;
      event.preventDefault();
      const current = outlineRef.current;
      if (current.phase === 'saving') return;
      const pageId = pageIdRef.current;
      const lib = libraryRef.current;
      const version = pageId && lib.graphId === pageId ? lib.graph.outlineVersion : null;
      const redo = event.shiftKey;
      void (async () => {
        if (redo) await current.redo();
        else await current.undo();
        if (!pageId || version === null || pageIdRef.current !== pageId) return;
        if (lib.graphId !== pageId || lib.graph.outlineVersion === version) return;
        await current.track(async () => {
          const ok = await persistRef.current(pageId);
          return ok ? { ok: true as const } : null;
        });
      })();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (modeRef.current !== 'board') return;
      if (event.repeat || event.isComposing) return;
      const slash = event.code === 'Slash' || event.key === '/' || event.key === '?';
      if (!slash) return;
      const toggleSelf = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === '/';
      const toggleBranch =
        (event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey) ||
        (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey);
      if (!toggleSelf && !toggleBranch) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('.usel') !== null) return;
      if (document.querySelector('.modal-wrap, .overlay, .addm-overlay, .ctx-menu')) return;
      const ids = nodeIdsRef.current;
      if (ids.length !== 1) return;
      const nodeId = ids[0];
      if (!nodeId) return;
      const pageId = pageIdRef.current;
      const lib = libraryRef.current;
      if (!pageId || lib.graphId !== pageId) return;
      if (!lib.graph.nodes.some((node) => node.id === nodeId)) return;
      event.preventDefault();
      const members = lib.graph.nodes.map((node) => ({ id: node.id, parentId: node.parentId }));
      const next = toggleBranch ? branchFold(foldRef.current, nodeId, members) : toggleFold(foldRef.current, nodeId);
      commitFoldRef.current(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!id || missing) {
    return (
      <div className="board-stage">
        <p className="board-missing">这个合集没有找到</p>
        <Link to="/library">回到全貌</Link>
      </div>
    );
  }
  const pageId = id;

  const current = library.graphId === id;
  const nodes = current ? library.graph.nodes : [];
  const edges = current ? library.graph.edges : [];
  const inclusions = current ? library.graph.inclusions : [];
  const projected = projectCollection({
    nodes,
    edges,
    bridges: current ? library.graph.bridges : [],
    inclusions,
  });
  const mindAt = new Map<string, { x: number; y: number }>();
  if (current) {
    const boxes = layoutDirect(
      nodes,
      library.graph.layoutDirection,
      storedAnchors(nodes),
      boardFold,
      edges,
    );
    for (const box of boxes) mindAt.set(box.id, { x: box.x, y: box.y });
  }

  function liveInclusions() {
    return library.graphId === id ? library.graph.inclusions : [];
  }

  function toLocal(groupId: string | null, x: number, y: number) {
    if (!groupId) return { x, y };
    const inclusion = liveInclusions().find((item) => item.childId === groupId);
    if (!inclusion) return { x, y };
    return { x: x - inclusion.x, y: y - inclusion.y };
  }

  function pickNodes(ids: string[]) {
    setRemoveAsk(null);
    setNodeIds(ids);
    if (ids.length !== 1) {
      setSelection(null);
      const last = [...ids].reverse().find((nodeId) => !nodeId.startsWith('uploading:') && inclusionChildId(nodeId) === null);
      setSelectedId(last ?? null);
      return;
    }
    const only = ids[0];
    if (!only || only.startsWith('uploading:')) {
      setSelectedId(null);
      setSelection(null);
      return;
    }
    const childId = inclusionChildId(only);
    if (childId) {
      setSelectedId(null);
      setSelection({ kind: 'inclusion', id: childId });
      return;
    }
    setSelectedId(only);
    setSelection(null);
    /* 面板打开期间点击其他点，内容跟随切换；没打开就只选中 */
    if (detail) {
      setDetail({ kind: 'node', id: only });
      void library.loadNode(only);
    }
  }

  function movePlaced(items: { id: string; x: number; y: number; z: number }[]): boolean | Promise<boolean> {
    let sawUpload = false;
    const rest: { id: string; x: number; y: number; z: number }[] = [];
    for (const item of items) {
      if (item.id.startsWith('uploading:')) {
        sawUpload = true;
        uploadsRef.current = uploadsRef.current.map((entry) =>
          entry.id === item.id ? { ...entry, x: item.x, y: item.y } : entry,
        );
        continue;
      }
      rest.push(item);
    }
    if (sawUpload) setUploads(uploadsRef.current);
    if (rest.length === 0) return true;
    if (!id) return false;
    const inclusions: { childId: string; x: number; y: number }[] = [];
    const rootMoves: { id: string; x: number; y: number }[] = [];
    const batches = new Map<string, { nodeId: string; x: number; y: number; z: number }[]>();
    for (const item of rest) {
      const childId = inclusionChildId(item.id);
      if (childId) {
        const inclusion = liveInclusions().find((entry) => entry.childId === childId);
        if (!inclusion) return false;
        const origin = collapsedOrigin(inclusion);
        inclusions.push({
          childId,
          x: inclusion.x + (item.x - origin.x),
          y: inclusion.y + (item.y - origin.y),
        });
        continue;
      }
      const home = homeOf(item.id);
      if (home.groupId === null) {
        const node = library.graphId === id ? library.graph.nodes.find((entry) => entry.id === item.id) : undefined;
        if (node?.parentId === null) {
          rootMoves.push({ id: item.id, x: item.x, y: item.y });
          continue;
        }
        if (node) continue;
      }
      const local = toLocal(home.groupId, item.x, item.y);
      const list = batches.get(home.collectionId) ?? [];
      list.push({ nodeId: item.id, x: local.x, y: local.y, z: item.z });
      batches.set(home.collectionId, list);
    }
    const pageId = id;
    return (async () => {
      let ok = true;
      for (const [collectionId, placements] of batches) {
        const saved = await library.savePlacements(collectionId, placements);
        if (!saved) ok = false;
      }
      for (const inclusion of inclusions) {
        const saved = await library.updateInclusion(pageId, inclusion.childId, { x: inclusion.x, y: inclusion.y });
        if (!saved) ok = false;
      }
      if (rootMoves.length === 1) {
        const spot = rootMoves[0];
        if (spot) {
          const saved = await trackDrop(pageId, { rootId: spot.id, x: spot.x, y: spot.y }, true);
          if (!saved) ok = false;
        }
      } else if (rootMoves.length > 1) {
        const saved = await trackShift(pageId, rootMoves);
        if (!saved) ok = false;
      }
      return ok;
    })();
  }

  function homeOf(nodeId: string) {
    const liveNodes = library.graphId === id ? library.graph.nodes : [];
    if (liveNodes.some((node) => node.id === nodeId)) return { collectionId: pageId, groupId: null as string | null };
    for (const inclusion of liveInclusions()) {
      if (inclusion.nodes.some((node) => node.id === nodeId)) {
        return { collectionId: inclusion.childId, groupId: inclusion.childId };
      }
    }
    return { collectionId: pageId, groupId: null as string | null };
  }

  function zOf(collectionId: string) {
    const pending = uploadsRef.current.filter((item) => item.homeId === collectionId).map((item) => item.z);
    if (collectionId === id) {
      const liveNodes = library.graphId === id ? library.graph.nodes : [];
      return [...liveNodes.map((node) => node.z), ...pending];
    }
    const inclusion = liveInclusions().find((item) => item.childId === collectionId);
    return [...(inclusion?.nodes.map((node) => node.z) ?? []), ...pending];
  }

  function storedNode(nodeId: string) {
    if (library.graphId !== id) return undefined;
    return (
      library.graph.nodes.find((node) => node.id === nodeId) ??
      library.graph.inclusions.flatMap((item) => item.nodes).find((node) => node.id === nodeId)
    );
  }

  function storedEdge(edgeId: string) {
    if (library.graphId !== id) return undefined;
    return (
      library.graph.edges.find((edge) => edge.id === edgeId) ??
      library.graph.bridges.find((edge) => edge.id === edgeId) ??
      library.graph.inclusions.flatMap((item) => item.edges).find((edge) => edge.id === edgeId)
    );
  }

  async function refresh() {
    await Promise.all([library.loadGraph(id as string), library.loadCollections()]);
  }

  /** 关闭详情面板：保留画布上的选中，只收面板 */
  function leave() {
    setDetail(null);
    void refresh();
  }

  async function insertImages(
    files: File[],
    at: { x: number; y: number },
    anchor: 'center' | 'corner',
    groupId: string | null,
  ) {
    if (!id || pageIdRef.current !== id) return;
    const pageId = id;
    const homeId = groupId ?? pageId;
    let failure = '';
    let placementError = '';
    const good: File[] = [];
    for (const file of files) {
      const issue = imageFileIssue(file);
      if (issue !== null) {
        if (failure === '') failure = issue;
        continue;
      }
      good.push(file);
    }
    const occupied: { x: number; y: number }[] = [];
    if (library.graphId === pageId) {
      for (const item of projected.items) {
        if (item.face === 'inclusion') continue;
        if (isFiniteNumber(item.x) && isFiniteNumber(item.y)) occupied.push({ x: item.x, y: item.y });
      }
    }
    for (const item of uploadsRef.current) occupied.push({ x: item.x, y: item.y });
    const spots = imageDropSpots(anchor, at, good.length, occupied).map((spot) =>
      snapPoint(spot, session.canvas.snap),
    );
    let z = nextPlacementZ(zOf(homeId));
    const batch: { spot: UploadSpot; file: File }[] = [];
    for (let index = 0; index < good.length; index += 1) {
      const file = good[index];
      const spot = spots[index];
      if (!file || !spot) continue;
      batch.push({
        file,
        spot: { id: `uploading:${crypto.randomUUID()}`, label: file.name, x: spot.x, y: spot.y, z, homeId },
      });
      z += 1;
    }
    if (batch.length > 0) {
      uploadsRef.current = [...uploadsRef.current, ...batch.map((item) => item.spot)];
      setUploads(uploadsRef.current);
    }
    for (const item of batch) {
      const startedX = item.spot.x;
      const startedY = item.spot.y;
      const local = toLocal(groupId, startedX, startedY);
      const posted = await postCollectionImage(homeId, item.file, local.x, local.y);
      if (pageIdRef.current !== pageId) return;
      const latest = uploadsRef.current.find((entry) => entry.id === item.spot.id);
      const finalX = latest?.x ?? startedX;
      const finalY = latest?.y ?? startedY;
      uploadsRef.current = uploadsRef.current.filter((entry) => entry.id !== item.spot.id);
      setUploads(uploadsRef.current);
      if (!posted.ok) {
        if (failure === '') failure = posted.message;
        continue;
      }
      await library.loadGraph(pageId);
      if (pageIdRef.current !== pageId) return;
      if (finalX !== startedX || finalY !== startedY) {
        const node = storedNode(posted.id);
        const nodeZ = node && isFiniteNumber(node.z) ? node.z : 0;
        const placed = toLocal(groupId, finalX, finalY);
        const saved = await library.savePlacements(homeId, [{ nodeId: posted.id, x: placed.x, y: placed.y, z: nodeZ }]);
        if (pageIdRef.current !== pageId) return;
        if (!saved && placementError === '') placementError = library.error;
      }
    }
    if (pageIdRef.current !== pageId) return;
    // loadGraph 会清掉 error，失败文案等这一批结束再写回。
    if (failure !== '') library.error = failure;
    else if (placementError !== '') library.error = placementError;
  }

  function chooseMode(next: CollectionViewMode) {
    if (!id || next === mode) return;
    writeCollectionView(id, next);
    setEntry('switch');
    setMode(next);
    if (next === 'board') {
      setStructure(false);
      setAdding(undefined);
      if (selection?.kind === 'edge') setNodeIds([]);
      else if (selection?.kind === 'inclusion') setNodeIds([inclusionItemId(selection.id)]);
      else if (selectedId) setNodeIds([selectedId]);
    }
  }

  function locateNode(nodeId: string) {
    setSelectedId(nodeId);
    setNodeIds([nodeId]);
    setFocus({ id: nodeId, tick: Date.now() });
  }

  function noteCreated(created: CreateNodeResult) {
    setCreateNotice(
      created.duplicates.length > 0 ? { name: created.name, duplicates: created.duplicates } : null,
    );
  }

  // 大纲结构操作走 outlineSession.phase，画板编辑走全局保存总线；按紧急程度合并两路状态。
  const savePhase =
    outlineSession.phase === 'saving' || save.phase === 'saving'
      ? 'saving'
      : outlineSession.phase === 'failed' || save.phase === 'failed'
        ? 'failed'
        : save.phase === 'dirty'
          ? 'dirty'
          : outlineSession.phase === 'saved' || save.phase === 'saved'
            ? 'saved'
            : 'idle';
  const saveText =
    savePhase === 'saving'
      ? '保存中'
      : savePhase === 'failed'
        ? '保存失败'
        : savePhase === 'saved'
          ? '已保存'
          : savePhase === 'dirty'
            ? '未保存'
            : '';

  return (
    <div className="board-stage">
      <div className="collection-bar">
        <div className="toolbar-pill">
          <USegmented
            ariaLabel="视图切换"
            options={[
              { value: 'outline', label: '大纲' },
              { value: 'board', label: '画板' },
            ]}
            value={mode}
            onChange={(next) => chooseMode(next as CollectionViewMode)}
          />
          <span className="toolbar-divider" />
          <button
            type="button"
            className="tbtn"
            title="撤销 ⌘Z"
            aria-label="撤销"
            disabled={!outlineSession.canUndo || outlineSession.phase === 'saving'}
            onClick={() => runHistory(false)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6.5h6a3.5 3.5 0 0 1 0 7H6" />
              <path d="M5.5 3.5 2.5 6.5l3 3" />
            </svg>
          </button>
          <button
            type="button"
            className="tbtn"
            title="重做 ⇧⌘Z"
            aria-label="重做"
            disabled={!outlineSession.canRedo || outlineSession.phase === 'saving'}
            onClick={() => runHistory(true)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M13 6.5H7a3.5 3.5 0 0 0 0 7h3" />
              <path d="M10.5 3.5l3 3-3 3" />
            </svg>
          </button>
          {mode === 'outline' ? (
            <>
              <span className="toolbar-divider" />
              <button
                type="button"
                className={structure ? 'tbtn pressed' : 'tbtn'}
                title="调整结构"
                aria-label="调整结构"
                aria-pressed={structure}
                disabled={!ready}
                onClick={() => setStructure((on) => !on)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2.5 4.5h11M2.5 8h11M5.5 11.5h8" />
                </svg>
              </button>
              {structure ? null : (
                <button
                  type="button"
                  className="tbtn"
                  title="加入已有点"
                  aria-label="加入已有点"
                  disabled={!ready}
                  onClick={() => setAdding(null)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </button>
              )}
            </>
          ) : null}
        </div>
        {mode === 'board' && createNotice ? (
          <CreateNoticeBanner notice={createNotice} onLocate={locateNode} onClose={() => setCreateNotice(null)} />
        ) : null}
      </div>
      <div className="save-corner">
        {saveText !== '' ? (
          <span className="save-chip" data-phase={savePhase} role="status">
            <span className="save-dot" />
            {saveText}
          </span>
        ) : null}
        {outlineSession.conflict ? (
          <span className="save-chip warn" role="alert">
            <span className="save-dot" />
            {outlineSession.conflictText}
            <button type="button" onClick={() => void outlineSession.reload()}>
              刷新
            </button>
          </span>
        ) : null}
        {mode === 'outline' && library.error !== '' && !outlineSession.conflict ? (
          <span className="save-chip warn" role="alert">
            {library.error}
          </span>
        ) : null}
      </div>
      <div className="board-frame">
        {mode === 'outline' && !ready ? (
          <div className="board-canvas">
            <p className="muted board-wait">正在读取…</p>
          </div>
        ) : null}
        {mode === 'outline' && ready ? (
          <OutlineView
            key={pageId}
            collectionId={pageId}
            selectedId={selectedId}
            revealId={nodeQuery !== '' ? nodeQuery : entry === 'switch' ? selectedId : null}
            focus={focus}
            entry={entry}
            session={outlineSession}
            structure={structure}
            onStructureChange={setStructure}
            adding={adding}
            onAddingChange={setAdding}
            createNotice={mode === 'outline' ? createNotice : null}
            onDismissNotice={() => setCreateNotice(null)}
            onSelect={(nodeId) => {
              setSelectedId(nodeId);
              setNodeIds([nodeId]);
            }}
            onOpen={(nodeId) => {
              setSelectedId(nodeId);
              setNodeIds([nodeId]);
              setDetail({ kind: 'node', id: nodeId });
              void library.loadNode(nodeId);
            }}
            onAskRemove={setMemberAsk}
          />
        ) : null}
        {mode === 'board' ? (
        <div className="board-canvas">
          {!ready ? <p className="muted board-wait">正在读取…</p> : null}
          {ready ? (
            <BoardCanvas
              fitKey={id}
              mindmap
              items={[
                ...projected.items.map((item) => {
                  const outlineOrder = nodes.find((node) => node.id === item.id)?.outlineOrder;
                  const withOrder = outlineOrder === undefined ? item : { ...item, outlineOrder };
                  if (item.groupId != null || item.face === 'inclusion') return withOrder;
                  const box = mindAt.get(item.id);
                  const placed = box ? { ...withOrder, x: box.x, y: box.y } : { ...withOrder, x: null, y: null };
                  if (!box) return placed;
                  const count = directChildCount(item.id, nodes);
                  if (count === 0) return placed;
                  return {
                    ...placed,
                    fold: {
                      side: foldSide(current ? library.graph.layoutDirection : 'right', item.id, nodes),
                      collapsed: boardFold.has(item.id),
                      count,
                    },
                  };
                }),
                ...uploads.map((item) => ({
                  id: item.id,
                  label: item.label,
                  x: item.x,
                  y: item.y,
                  z: item.z,
                  kind: 'image' as const,
                  uploading: true,
                })),
              ]}
              links={linksForFold(projected.links, boardFold, nodes)}
              onToggleFold={(nodeId) => commitFoldRef.current(toggleFold(foldRef.current, nodeId))}
              groups={projected.groups}
              selectedId={
                selection?.kind === 'inclusion'
                  ? inclusionItemId(selection.id)
                  : selection?.kind === 'edge'
                    ? selection.id
                    : selection?.kind === 'node'
                      ? selection.id
                      : (nodeIds[nodeIds.length - 1] ?? null)
              }
              selectedIds={nodeIds}
              onSelectIds={pickNodes}
              createPlaceholder="点的名字"
              onGrowNode={async (draft) => {
                if (!id || pageIdRef.current !== id || library.graphId !== id) return false;
                const pageId = id;
                const name = draft.name.trim();
                if (name === '') return false;
                const source = library.graph.nodes.find((node) => node.id === draft.nodeId);
                if ((draft.role === 'after' || draft.role === 'before') && !source) return false;
                const created = await outlineRef.current.track(async () => {
                  const node =
                    draft.role === 'parent'
                      ? await library.insertParent(pageId, {
                          expectedVersion: library.graph.outlineVersion,
                          nodeId: draft.nodeId,
                          name,
                        })
                      : await library.createNode(draft.groupId ?? pageId, name, {
                          parentId: draft.role === 'child' ? draft.nodeId : (source?.parentId ?? null),
                          ...(draft.role === 'before' ? { beforeNodeId: draft.nodeId } : {}),
                          ...(draft.role === 'after' ? { afterNodeId: draft.nodeId } : {}),
                        });
                  if (!node) return null;
                  if (pageIdRef.current !== pageId) return node;
                  await refresh();
                  if (pageIdRef.current !== pageId || library.graphId !== pageId) return node;
                  const restore = captureRemoval(library.graph.nodes, node.id);
                  if (restore) outlineRef.current.note({ type: 'create', restore });
                  return node;
                });
                if (!created) return false;
                if (pageIdRef.current !== pageId) return true;
                noteCreated(created);
                await trackPersist(pageId);
                if (pageIdRef.current !== pageId) return true;
                setSelectedId(created.id);
                setNodeIds([created.id]);
                setDetail({ kind: 'node', id: created.id });
                await library.loadNode(created.id);
                return true;
              }}
              onMoveSibling={(nodeId, direction) => {
                if (!id || library.graphId !== id) return;
                const items = library.graph.nodes.map((node) => ({
                  nodeId: node.id,
                  parentId: node.parentId,
                  order: node.outlineOrder,
                }));
                const next = moveSibling(items, nodeId, direction);
                if (!outlineMoved(items, next, nodeId)) return;
                void library.putOutline(id, library.graph.outlineVersion, next);
              }}
              onCreate={(name, at, groupId) => {
                void (async () => {
                  const homeId = groupId ?? id;
                  if (groupId === null) {
                    if (!id) return;
                    const pageId = id;
                    const drop = { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 };
                    const created = await outlineRef.current.track(async () => {
                      const node = await library.createNode(pageId, name);
                      if (!node) return null;
                      if (pageIdRef.current !== pageId || library.graphId !== pageId) return node;
                      const folded = readBoardFold(pageId);
                      const anchors = anchorForRootDrop(
                        storedAnchors(library.graph.nodes),
                        node.id,
                        drop,
                        (trial) =>
                          layoutDirect(library.graph.nodes, library.graph.layoutDirection, trial, folded, library.graph.edges),
                      );
                      const point = anchors?.get(node.id);
                      if (point) {
                        // 锚点必须赶在第一次绘制前写上。先刷新会按未锚定位置画一帧；
                        // 本地坐标对齐后 persistMindmap 会跳过写入，所以直接保存这一处。
                        library.graph = {
                          ...library.graph,
                          nodes: library.graph.nodes.map((item) =>
                            item.id === node.id ? { ...item, x: point.x, y: point.y, z: 0 } : item,
                          ),
                        };
                        await library.savePlacements(pageId, [{ nodeId: node.id, x: point.x, y: point.y, z: 0 }]);
                      }
                      if (pageIdRef.current !== pageId || library.graphId !== pageId) return node;
                      const restore = captureRemoval(library.graph.nodes, node.id);
                      if (restore) outlineRef.current.note({ type: 'create', restore });
                      return node;
                    });
                    if (!created || pageIdRef.current !== pageId) return;
                    noteCreated(created);
                    if (pageIdRef.current !== pageId) return;
                    setSelectedId(created.id);
                    setNodeIds([created.id]);
                    setDetail({ kind: 'node', id: created.id });
                    await library.loadNode(created.id);
                    return;
                  }
                  const created = await library.createNode(homeId, name);
                  if (!created) return;
                  noteCreated(created);
                  placeTried.current.add(`${id}:node:${created.id}`);
                  const local = toLocal(groupId, at.x - 84, at.y - 28);
                  const z = nextPlacementZ(zOf(homeId));
                  const saved = await library.savePlacements(homeId, [
                    { nodeId: created.id, x: local.x, y: local.y, z },
                  ]);
                  const placementError = saved ? '' : library.error;
                  await refresh();
                  setSelectedId(created.id);
                  setNodeIds([created.id]);
                  setDetail({ kind: 'node', id: created.id });
                  await library.loadNode(created.id);
                  if (placementError !== '') library.error = placementError;
                })();
              }}
              onInsertImages={(files, at, anchor, groupId) => {
                const job = intakeQueue.current.then(() => insertImages(files, at, anchor, groupId));
                intakeQueue.current = job.then(
                  () => undefined,
                  () => undefined,
                );
              }}
              onMove={(nodeId, x, y, z) => movePlaced([{ id: nodeId, x, y, z }])}
              onMoveItems={movePlaced}
              onMindmapDrop={(input) => {
                if (!id || library.graphId !== id) return false;
                if (hasOutlineCycle(input.items)) return false;
                const pageId = id;
                const session = outlineRef.current;
                return (async () => {
                  const ok = await session.applyStructure(input.items);
                  if (!ok || pageIdRef.current !== pageId) return ok;
                  const drop = input.anchor
                    ? { rootId: input.nodeId, x: input.anchor.x, y: input.anchor.y }
                    : null;
                  return trackDrop(pageId, drop);
                })();
              }}
              onResizeImage={(nodeId, imageWidth) => {
                if (nodeId.startsWith('uploading:')) return false;
                const direct = library.graphId === id ? library.graph.nodes.find((entry) => entry.id === nodeId) : undefined;
                if (direct) {
                  const anchors = storedAnchors(library.graph.nodes);
                  return (async () => {
                    const saved = await library.savePlacements(id, [
                      {
                        nodeId,
                        x: isFiniteNumber(direct.x) ? direct.x : 0,
                        y: isFiniteNumber(direct.y) ? direct.y : 0,
                        z: isFiniteNumber(direct.z) ? direct.z : 0,
                        imageWidth,
                      },
                    ]);
                    if (!saved || pageIdRef.current !== id) return saved;
                    await trackPersist(id, { anchors });
                    return true;
                  })();
                }
                for (const inclusion of liveInclusions()) {
                  const node = inclusion.nodes.find((entry) => entry.id === nodeId);
                  if (!node || !isFiniteNumber(node.x) || !isFiniteNumber(node.y)) continue;
                  return library.savePlacements(inclusion.childId, [
                    { nodeId, x: node.x, y: node.y, z: isFiniteNumber(node.z) ? node.z : 0, imageWidth },
                  ]);
                }
                return false;
              }}
              onPlaceUnpositioned={(spots) => {
                const fresh = spots.filter((spot) => {
                  if (inclusionChildId(spot.id) !== null) return false;
                  if (placeTried.current.has(`${id}:node:${spot.id}`)) return false;
                  const home = homeOf(spot.id);
                  if (home.groupId === null) return false;
                  const inclusion = liveInclusions().find((item) => item.childId === home.groupId);
                  if (!inclusion) return true;
                  return inclusion.nodes.some((node) => isFiniteNumber(node.x));
                });
                if (fresh.length === 0) return;
                const key = `${id}:part:${[...fresh.map((spot) => spot.id)].sort().join(',')}`;
                if (placeTried.current.has(key)) return;
                placeTried.current.add(key);
                const batches = new Map<string, { nodeId: string; x: number; y: number }[]>();
                for (const spot of fresh) {
                  placeTried.current.add(`${id}:node:${spot.id}`);
                  const home = homeOf(spot.id);
                  const local = toLocal(home.groupId, spot.x, spot.y);
                  const list = batches.get(home.collectionId) ?? [];
                  list.push({ nodeId: spot.id, x: local.x, y: local.y });
                  batches.set(home.collectionId, list);
                }
                for (const [collectionId, list] of batches) {
                  const z0 = nextPlacementZ(zOf(collectionId));
                  void library.savePlacements(
                    collectionId,
                    list.map((spot, index) => ({ nodeId: spot.nodeId, x: spot.x, y: spot.y, z: z0 + index })),
                  );
                }
              }}
              onRenameItem={(nodeId, name) => {
                if (nodeId.startsWith('uploading:')) return;
                void library.renameNode(nodeId, name);
              }}
              enableTools
              appearance={current ? library.graph.appearance : defaultEdgeAppearance}
              canvas={session.canvas}
              onAppearance={(next) => {
                if (!id) return;
                void library.updateAppearance(id, next);
              }}
              onCanvas={(patch) => {
                void session.updateCanvas(patch);
              }}
              layoutDirection={current ? library.graph.layoutDirection : 'right'}
              onLayoutDirection={(direction) => {
                if (!id || pageIdRef.current !== id || library.graphId !== id) return;
                if (direction === library.graph.layoutDirection) return;
                const pageId = id;
                const epoch = ++layoutEpoch.current;
                void (async () => {
                  const ok = await library.updateLayout(pageId, direction);
                  if (!ok || epoch !== layoutEpoch.current || pageIdRef.current !== pageId) return;
                  const loaded = await library.loadGraph(pageId);
                  if (!loaded || epoch !== layoutEpoch.current || pageIdRef.current !== pageId) return;
                  await trackPersist(pageId);
                })();
              }}
              onFlipSide={(nodeId) => {
                if (!id || pageIdRef.current !== id || library.graphId !== id) return;
                if (library.graph.layoutDirection !== 'both') return;
                const nodes = library.graph.nodes;
                const node = nodes.find((item) => item.id === nodeId);
                if (!node?.parentId) return;
                const parent = nodes.find((item) => item.id === node.parentId);
                if (!parent || parent.parentId !== null) return;
                const pageId = id;
                const side = foldSide(library.graph.layoutDirection, nodeId, nodes) === 'left' ? 'right' : 'left';
                void (async () => {
                  const ok = await library.updateMemberSide(pageId, nodeId, side);
                  if (!ok || pageIdRef.current !== pageId || library.graphId !== pageId) return;
                  await trackPersist(pageId);
                })();
              }}
              onConnect={(fromId, toId, label) => {
                if (fromId.startsWith('uploading:') || toId.startsWith('uploading:')) return;
                void (async () => {
                  const created = await outlineRef.current.track(async () => {
                    const edge = await library.createEdge(fromId, toId, label);
                    if (!edge) return null;
                    outlineRef.current.note({
                      type: 'edge-create',
                      edge: { edgeId: edge.id, fromId: edge.fromId, toId: edge.toId, label: edge.label },
                    });
                    await refresh();
                    return edge;
                  });
                  if (!created) return;
                  setNodeIds([]);
                  setSelection({ kind: 'edge', id: created.id });
                  setDetail({ kind: 'edge', id: created.id });
                  await library.loadEdge(created.id);
                })();
              }}
              onRelabel={(edgeId, label) => {
                const next = label.trim();
                if (next === '') return;
                const edge = storedEdge(edgeId);
                if (!edge || next === edge.label) return;
                void library.renameEdge(edgeId, next);
              }}
              renderPeek={(nodeId) => {
                if (inclusionChildId(nodeId) !== null) return null;
                const node = storedNode(nodeId);
                if (!node) return null;
                return <NodePeek nodeId={nodeId} name={node.name} count={node.cardCount} />;
              }}
              onPeekItem={(nodeId) => {
                if (nodeId?.startsWith('uploading:') || (nodeId !== null && inclusionChildId(nodeId) !== null)) return;
                if (nodeId) void library.loadPeek(nodeId);
                else library.clearPeek();
              }}
              onRemoveItem={(nodeId) => {
                if (!id || nodeId.startsWith('uploading:') || inclusionChildId(nodeId) !== null) return;
                setMemberAsk(nodeId);
              }}
              onMoveInclusion={(childId, x, y) => library.updateInclusion(id, childId, { x, y })}
              onToggleInclusion={(childId) => {
                const inclusion = liveInclusions().find((item) => item.childId === childId);
                if (!inclusion) return;
                void library.updateInclusion(id, childId, { collapsed: !inclusion.collapsed });
              }}
              onRemoveInclusion={(childId) => {
                void (async () => {
                  const ok = await library.removeInclusion(id, childId);
                  if (!ok) return;
                  if (selection?.kind === 'inclusion' && selection.id === childId) setSelection(null);
                  setNodeIds((current) => current.filter((nodeId) => nodeId !== inclusionItemId(childId)));
                  await refresh();
                })();
              }}
              onInsertInclusion={(origin) => setInsertAt(origin)}
              onAskRemoveItem={(nodeId) => {
                if (nodeId.startsWith('uploading:') || inclusionChildId(nodeId) !== null) return;
                removeToken.current += 1;
                setSelectedId(nodeId);
                setNodeIds([nodeId]);
                setDetail({ kind: 'node', id: nodeId });
                void library.loadNode(nodeId);
                setRemoveAsk({ kind: 'node', id: nodeId, token: removeToken.current });
              }}
              onAskRemoveLink={(edgeId) => {
                removeToken.current += 1;
                setNodeIds([]);
                setSelection({ kind: 'edge', id: edgeId });
                setDetail({ kind: 'edge', id: edgeId });
                void library.loadEdge(edgeId);
                setRemoveAsk({ kind: 'edge', id: edgeId, token: removeToken.current });
              }}
              onEscape={() => {
                setSelectedId(null);
                setNodeIds([]);
                setSelection(null);
                setDetail(null);
              }}
              onSelectItem={(nodeId) => pickNodes([nodeId])}
              onSelectLink={(edgeId) => {
                setNodeIds([]);
                setRemoveAsk(null);
                setSelection({ kind: 'edge', id: edgeId });
                if (detail) {
                  setDetail({ kind: 'edge', id: edgeId });
                  void library.loadEdge(edgeId);
                }
              }}
              onInspectItem={(nodeId) => {
                if (nodeId.startsWith('uploading:') || inclusionChildId(nodeId) !== null) return;
                setDetail({ kind: 'node', id: nodeId });
                void library.loadNode(nodeId);
              }}
              onInspectLink={(edgeId) => {
                setDetail({ kind: 'edge', id: edgeId });
                void library.loadEdge(edgeId);
              }}
            />
          ) : null}
          {ready && nodes.length === 0 && inclusions.length === 0 ? (
            <div className="board-empty">
              <p className="muted">先添加一个点</p>
            </div>
          ) : null}
          {ready && nodes.length <= 2 && inclusions.length === 0 ? (
            <p className="canvas-hint">
              双击空白新建根主题 · 拖入图片 · 拖动点 · 拖空白框选 · ⌘ 或 Ctrl 点选多个 · 从圆点拖线或按 L 连线 · 选中一个点后 Tab 建子主题、Enter 建同级 · 工具栏或右键可插入子集合
            </p>
          ) : null}
          {session.canvasError !== '' || library.error !== '' ? (
            <p role="alert" className="canvas-error">
              {session.canvasError !== '' ? session.canvasError : library.error}
            </p>
          ) : null}
        </div>
        ) : null}
        {detail?.kind === 'node' ? (
          <NodePanel
            collectionId={id}
            nodeId={detail.id}
            focusCardId={cardQuery || null}
            askRemove={removeAsk?.kind === 'node' && removeAsk.id === detail.id ? removeAsk.token : 0}
            onAskRemove={() => setMemberAsk(detail.id)}
            onLocated={locateNode}
            onLeave={leave}
            onTouched={() => void refresh()}
            onDescribed={async () => {
              await trackPersist(pageId);
            }}
          />
        ) : null}
        {detail?.kind === 'edge' ? (
          <EdgePanel
            edgeId={detail.id}
            focusCardId={cardQuery || null}
            askRemove={removeAsk?.kind === 'edge' && removeAsk.id === detail.id ? removeAsk.token : 0}
            onLeave={leave}
            onTouched={() => void refresh()}
          />
        ) : null}
      </div>
      {memberAsk ? (
        <UConfirm
          title="移出当前合集"
          body="只移出这个合集。它下面的项会升到同一级，点和关系都还在。"
          confirmLabel="移出"
          onCancel={() => setMemberAsk(null)}
          onConfirm={() => {
            const nodeId = memberAsk;
            setMemberAsk(null);
            void (async () => {
              const direct = library.graphId === pageId && library.graph.nodes.some((node) => node.id === nodeId);
              let ok = false;
              if (direct) {
                ok = await outlineSession.removeDirect(nodeId);
              } else {
                const home = homeOf(nodeId);
                const result = await library.removeMember(home.collectionId, nodeId);
                ok = result.ok;
                if (ok) await refresh();
              }
              if (!ok) return;
              setSelectedId((current) => (current === nodeId ? null : current));
              setNodeIds((current) => current.filter((item) => item !== nodeId));
              setSelection((current) => (current?.kind === 'node' && current.id === nodeId ? null : current));
              setDetail((current) => (current?.kind === 'node' && current.id === nodeId ? null : current));
            })();
          }}
        />
      ) : null}
      {insertAt ? (
        <InclusionDialog
          collectionId={id}
          origin={insertAt}
          onClose={() => setInsertAt(null)}
          onInserted={() => void refresh()}
        />
      ) : null}
    </div>
  );
});

type PostedImage = { ok: true; id: string } | { ok: false; message: string };

async function postCollectionImage(collectionId: string, file: File, x: number, y: number): Promise<PostedImage> {
  const body = new FormData();
  body.append('file', file);
  body.append('x', String(x));
  body.append('y', String(y));
  const res = await apiSend(`/api/collections/${collectionId}/images`, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  if (!res) return { ok: false, message: '网络没有连上' };
  if (!res.ok) return { ok: false, message: await errorMessage(res, '图片没有放进去') };
  try {
    const created = createdNodeId(await res.json());
    if (!created) return { ok: false, message: '图片没有放进去' };
    return { ok: true, id: created };
  } catch {
    return { ok: false, message: '图片没有放进去' };
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return true;
  }
  return target.closest('input, textarea, .tiptap, [contenteditable="true"]') !== null;
}

function createdNodeId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('id' in data)) return null;
  const id = data.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

function writeBoardFold(collectionId: string, ids: readonly string[]) {
  try {
    sessionStorage.setItem(`unfold.board-fold.v1:${collectionId}`, JSON.stringify(ids));
  } catch {
    // 写不进去时只保留这一帧的状态
  }
}

function readBoardFold(collectionId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(`unfold.board-fold.v1:${collectionId}`);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function mindmapNodes(nodes: readonly GraphNode[]) {
  return nodes.map((node) => {
    const frame = node.kind === 'image' ? imageFrame(node.imageWidth, 1) : null;
    return {
      id: node.id,
      parentId: node.parentId,
      order: node.outlineOrder,
      side: node.layoutSide,
      w: frame ? frame.w : NODE_W,
      h: frame ? frame.h : textNodeHeight(node.description),
    };
  });
}

function storedAnchors(nodes: readonly GraphNode[]): Map<string, { x: number; y: number }> {
  const anchors = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (node.parentId !== null) continue;
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) continue;
    anchors.set(node.id, { x: node.x, y: node.y });
  }
  return anchors;
}

function layoutDirect(
  nodes: readonly GraphNode[],
  direction: LayoutDirection,
  anchors: ReadonlyMap<string, { x: number; y: number }>,
  folded: ReadonlySet<string>,
  links: readonly { fromId: string; toId: string; label: string }[],
): MindmapBox[] {
  const shaped = mindmapNodes(nodes);
  return layoutMindmap({
    nodes: shaped,
    folded,
    direction,
    anchors,
    rootGap: MINDMAP_ROOT_GAP,
    levelGap: MINDMAP_LEVEL_GAP,
    siblingGap: MINDMAP_SIBLING_GAP,
    originX: MINDMAP_ORIGIN_X,
    originY: MINDMAP_ORIGIN_Y,
    levelExtra: branchLevelExtra(shaped, links),
  });
}

function inclusionObstacles(inclusions: readonly GraphInclusion[], directIds: ReadonlySet<string>): ObstacleRect[] {
  const obstacles: ObstacleRect[] = [];
  for (const inclusion of inclusions) {
    if (inclusion.collapsed) {
      const origin = collapsedOrigin(inclusion);
      obstacles.push({
        x: origin.x,
        y: origin.y,
        w: NODE_W,
        h: textNodeHeight(`子集合 · ${inclusion.nodes.length} 个点`),
      });
      continue;
    }
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
    const memberIds: string[] = [];
    for (const node of inclusion.nodes) {
      if (directIds.has(node.id)) continue;
      memberIds.push(node.id);
      if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) continue;
      const frame = node.kind === 'image' ? imageFrame(node.imageWidth, 1) : null;
      boxes.set(node.id, {
        x: node.x + inclusion.x,
        y: node.y + inclusion.y,
        w: frame ? frame.w : NODE_W,
        h: frame ? frame.h : textNodeHeight(node.description),
      });
    }
    const rect = inclusionFrameRect(
      {
        childId: inclusion.childId,
        title: inclusion.title,
        labels: inclusion.labels,
        anchorX: inclusion.x,
        anchorY: inclusion.y,
        collapsed: false,
        memberIds,
      },
      boxes,
    );
    if (rect) obstacles.push(rect);
  }
  return obstacles;
}
