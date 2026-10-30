import { observer, useService } from '@rabjs/react';
import { defaultEdgeAppearance, type CreateNodeResult } from '@unfold/dto';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BoardCanvas } from '../board/board-canvas.js';
import { imageDropSpots, imageFileIssue } from '../board/image-intake.js';
import { isFiniteNumber, layoutBoard, nextPlacementZ } from '../board/board-layout.js';
import { collapsedOrigin, inclusionChildId, inclusionItemId, projectCollection } from '../board/inclusion-view.js';
import { snapPoint } from '../board/snap.js';
import { readCollectionView, writeCollectionView, type CollectionViewMode } from '../outline/collection-view.js';
import { CreateNoticeBanner, OutlineView, type CreateNotice } from '../outline/outline-view.js';
import { useOutlineSession } from '../outline/outline-session.js';
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
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
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
  const [uploads, setUploads] = useState<UploadSpot[]>([]);
  const [insertAt, setInsertAt] = useState<{ x: number; y: number } | null>(null);
  const uploadsRef = useRef<UploadSpot[]>([]);
  const pageIdRef = useRef(id);
  const intakeQueue = useRef(Promise.resolve());
  const placeTried = useRef(new Set<string>());
  const removeToken = useRef(0);
  const [removeAsk, setRemoveAsk] = useState<{ kind: 'node' | 'edge'; id: string; token: number } | null>(null);
  pageIdRef.current = id;
  if (id !== seenId) {
    setSeenId(id);
    setReady(false);
    setMissing(false);
    setSelection(null);
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
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setReady(false);
    setMissing(false);
    setSelection(null);
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
        setSelection({ kind: 'node', id: nodeQuery });
        void library.loadNode(nodeQuery);
      } else if (edgeQuery !== '') {
        setNodeIds([]);
        setSelection({ kind: 'edge', id: edgeQuery });
        void library.loadEdge(edgeQuery);
      }
    })();
    return () => {
      alive = false;
    };
  }, [edgeQuery, id, library, nodeQuery]);

  useEffect(() => {
    if (!ready || !id || library.graphId !== id) return;
    const nodes = library.graph.nodes;
    if (nodes.length > 0 && nodes.every((node) => !isFiniteNumber(node.x))) {
      const key = `${id}:all`;
      if (!placeTried.current.has(key)) {
        placeTried.current.add(key);
        const boxes = layoutBoard(
          nodes.map((node) => ({ id: node.id })),
          library.graph.edges.map((edge) => ({ fromId: edge.fromId, toId: edge.toId })),
        );
        void library.savePlacements(
          id,
          boxes.map((box, index) => ({ nodeId: box.id, x: box.x, y: box.y, z: index })),
        );
      }
    }
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
      if (event.shiftKey) void current.redo();
      else void current.undo();
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
    setSelection({ kind: 'node', id: only });
    void library.loadNode(only);
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
      const local = toLocal(home.groupId, item.x, item.y);
      const list = batches.get(home.collectionId) ?? [];
      list.push({ nodeId: item.id, x: local.x, y: local.y, z: item.z });
      batches.set(home.collectionId, list);
    }
    return (async () => {
      let ok = true;
      for (const [collectionId, placements] of batches) {
        const saved = await library.savePlacements(collectionId, placements);
        if (!saved) ok = false;
      }
      for (const inclusion of inclusions) {
        const saved = await library.updateInclusion(id, inclusion.childId, { x: inclusion.x, y: inclusion.y });
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

  function leave() {
    setSelection(null);
    setNodeIds([]);
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
            onClick={() => void outlineSession.undo()}
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
            onClick={() => void outlineSession.redo()}
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
              setSelection({ kind: 'node', id: nodeId });
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
              items={[
                ...projected.items,
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
              links={projected.links}
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
              onGrowNode={(draft) => {
                void (async () => {
                  if (!id || pageIdRef.current !== id) return;
                  const pageId = id;
                  const collectionId = draft.groupId ?? pageId;
                  const created = await library.createNode(collectionId, draft.name);
                  if (!created || pageIdRef.current !== pageId) return;
                  noteCreated(created);
                  placeTried.current.add(`${pageId}:node:${created.id}`);
                  const local = toLocal(draft.groupId, draft.x, draft.y);
                  const z = nextPlacementZ(zOf(collectionId));
                  const saved = await library.savePlacements(collectionId, [
                    { nodeId: created.id, x: local.x, y: local.y, z },
                  ]);
                  const placementError = saved ? '' : library.error;
                  if (pageIdRef.current !== pageId) return;
                  await refresh();
                  if (pageIdRef.current !== pageId) return;
                  setSelectedId(created.id);
                  setNodeIds([created.id]);
                  setSelection({ kind: 'node', id: created.id });
                  await library.loadNode(created.id);
                  if (pageIdRef.current !== pageId) return;
                  if (placementError !== '') library.error = placementError;
                })();
              }}
              onCreate={(name, at, groupId) => {
                void (async () => {
                  const homeId = groupId ?? id;
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
                  setSelection({ kind: 'node', id: created.id });
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
              onResizeImage={(nodeId, imageWidth) => {
                if (nodeId.startsWith('uploading:')) return false;
                const direct = library.graphId === id ? library.graph.nodes.find((entry) => entry.id === nodeId) : undefined;
                if (direct && isFiniteNumber(direct.x) && isFiniteNumber(direct.y)) {
                  return library.savePlacements(id, [
                    { nodeId, x: direct.x, y: direct.y, z: isFiniteNumber(direct.z) ? direct.z : 0, imageWidth },
                  ]);
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
                  if (home.groupId === null) return true;
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
              onConnect={(fromId, toId, label) => {
                if (fromId.startsWith('uploading:') || toId.startsWith('uploading:')) return;
                void (async () => {
                  const created = await library.createEdge(fromId, toId, label);
                  if (!created) return;
                  await refresh();
                  setNodeIds([]);
                  setSelection({ kind: 'edge', id: created.id });
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
                setSelection({ kind: 'node', id: nodeId });
                void library.loadNode(nodeId);
                setRemoveAsk({ kind: 'node', id: nodeId, token: removeToken.current });
              }}
              onAskRemoveLink={(edgeId) => {
                removeToken.current += 1;
                setNodeIds([]);
                setSelection({ kind: 'edge', id: edgeId });
                void library.loadEdge(edgeId);
                setRemoveAsk({ kind: 'edge', id: edgeId, token: removeToken.current });
              }}
              onEscape={() => {
                setSelectedId(null);
                setNodeIds([]);
                setSelection(null);
              }}
              onSelectItem={(nodeId) => pickNodes([nodeId])}
              onSelectLink={(edgeId) => {
                setNodeIds([]);
                setRemoveAsk(null);
                setSelection({ kind: 'edge', id: edgeId });
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
              双击空白添加文字 · 拖入图片 · 拖动点 · 拖空白框选 · ⌘ 或 Ctrl 点选多个 · 从圆点拖线或按 L 连线 · 选中一个点后 Tab 在旁边新建、Enter 在下方新建 · 工具栏或右键可插入子集合
            </p>
          ) : null}
          {session.canvasError !== '' || library.error !== '' ? (
            <p role="alert" className="canvas-error">
              {session.canvasError !== '' ? session.canvasError : library.error}
            </p>
          ) : null}
        </div>
        ) : null}
        {selection?.kind === 'node' ? (
          <NodePanel
            collectionId={id}
            nodeId={selection.id}
            focusCardId={cardQuery || null}
            askRemove={removeAsk?.kind === 'node' && removeAsk.id === selection.id ? removeAsk.token : 0}
            onAskRemove={() => setMemberAsk(selection.id)}
            onLocated={locateNode}
            onLeave={leave}
            onTouched={() => void refresh()}
          />
        ) : null}
        {selection?.kind === 'edge' ? (
          <EdgePanel
            edgeId={selection.id}
            focusCardId={cardQuery || null}
            askRemove={removeAsk?.kind === 'edge' && removeAsk.id === selection.id ? removeAsk.token : 0}
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
