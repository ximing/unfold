import { observer, useService } from '@rabjs/react';
import { defaultEdgeAppearance } from '@unfold/dto';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BoardCanvas } from '../board/board-canvas.js';
import { imageDropSpots, imageFileIssue } from '../board/image-intake.js';
import { isFiniteNumber, layoutBoard, nextPlacementZ } from '../board/board-layout.js';
import { collapsedOrigin, inclusionChildId, inclusionItemId, projectCollection } from '../board/inclusion-view.js';
import { snapPoint } from '../board/snap.js';
import { InclusionDialog } from './inclusion-dialog.js';
import { apiSend, errorMessage } from '../library/api.js';
import { LibraryService } from '../library/library.service.js';
import { SessionService } from '../session/session.service.js';
import { EdgePanel } from './edge-panel.js';
import { NodePanel } from './node-panel.js';
import { NodePeek } from './node-peek.js';

type Selection = { kind: 'node' | 'edge' | 'inclusion'; id: string } | null;

type UploadSpot = { id: string; label: string; x: number; y: number; z: number; homeId: string };

export const CollectionPage = observer(function CollectionPage() {
  const library = useService(LibraryService);
  const session = useService(SessionService);
  const { id } = useParams();
  const [params] = useSearchParams();
  const nodeQuery = params.get('node') ?? '';
  const edgeQuery = params.get('edge') ?? '';
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
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
        setSelection({ kind: 'node', id: nodeQuery });
        void library.loadNode(nodeQuery);
      } else if (edgeQuery !== '') {
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

  return (
    <div className="board-stage">
      <div className="board-frame">
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
              selectedId={selection?.kind === 'inclusion' ? inclusionItemId(selection.id) : (selection?.id ?? null)}
              createPlaceholder="点的名字"
              onGrowBlocked={(message) => {
                library.error = message;
              }}
              onGrowNode={(draft) => {
                void (async () => {
                  if (!id || pageIdRef.current !== id) return;
                  const pageId = id;
                  const collectionId = draft.groupId ?? pageId;
                  const created = await library.createNode(collectionId, draft.name);
                  if (!created || pageIdRef.current !== pageId) return;
                  placeTried.current.add(`${pageId}:node:${created.id}`);
                  const local = toLocal(draft.groupId, draft.x, draft.y);
                  const z = nextPlacementZ(zOf(collectionId));
                  const saved = await library.savePlacements(collectionId, [
                    { nodeId: created.id, x: local.x, y: local.y, z },
                  ]);
                  const placementError = saved ? '' : library.error;
                  let linkError = '';
                  if (draft.fromId && draft.label && pageIdRef.current === pageId) {
                    const linked = await library.createEdge(draft.fromId, created.id, draft.label);
                    if (!linked && pageIdRef.current === pageId) linkError = library.error;
                  }
                  if (pageIdRef.current !== pageId) return;
                  await refresh();
                  if (pageIdRef.current !== pageId) return;
                  setSelection({ kind: 'node', id: created.id });
                  await library.loadNode(created.id);
                  if (pageIdRef.current !== pageId) return;
                  if (placementError !== '') library.error = placementError;
                  else if (linkError !== '') library.error = linkError;
                })();
              }}
              onCreate={(name, at, groupId) => {
                void (async () => {
                  const homeId = groupId ?? id;
                  const created = await library.createNode(homeId, name);
                  if (!created) return;
                  placeTried.current.add(`${id}:node:${created.id}`);
                  const local = toLocal(groupId, at.x - 84, at.y - 28);
                  const z = nextPlacementZ(zOf(homeId));
                  const saved = await library.savePlacements(homeId, [
                    { nodeId: created.id, x: local.x, y: local.y, z },
                  ]);
                  const placementError = saved ? '' : library.error;
                  await refresh();
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
              onMove={(nodeId, x, y, z) => {
                if (nodeId.startsWith('uploading:')) {
                  uploadsRef.current = uploadsRef.current.map((item) =>
                    item.id === nodeId ? { ...item, x, y } : item,
                  );
                  setUploads(uploadsRef.current);
                  return true;
                }
                const childId = inclusionChildId(nodeId);
                if (childId) {
                  const inclusion = liveInclusions().find((item) => item.childId === childId);
                  if (!inclusion) return false;
                  const origin = collapsedOrigin(inclusion);
                  return library.updateInclusion(id, childId, {
                    x: inclusion.x + (x - origin.x),
                    y: inclusion.y + (y - origin.y),
                  });
                }
                const home = homeOf(nodeId);
                const local = toLocal(home.groupId, x, y);
                return library.savePlacements(home.collectionId, [{ nodeId, x: local.x, y: local.y, z }]);
              }}
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
                void (async () => {
                  const home = homeOf(nodeId);
                  const ok = await library.removeMember(home.collectionId, nodeId);
                  if (!ok) return;
                  leave();
                })();
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
                  await refresh();
                })();
              }}
              onInsertInclusion={(origin) => setInsertAt(origin)}
              onAskRemoveItem={(nodeId) => {
                if (nodeId.startsWith('uploading:') || inclusionChildId(nodeId) !== null) return;
                removeToken.current += 1;
                setSelection({ kind: 'node', id: nodeId });
                void library.loadNode(nodeId);
                setRemoveAsk({ kind: 'node', id: nodeId, token: removeToken.current });
              }}
              onAskRemoveLink={(edgeId) => {
                removeToken.current += 1;
                setSelection({ kind: 'edge', id: edgeId });
                void library.loadEdge(edgeId);
                setRemoveAsk({ kind: 'edge', id: edgeId, token: removeToken.current });
              }}
              onEscape={() => setSelection(null)}
              onSelectItem={(nodeId) => {
                if (nodeId.startsWith('uploading:')) return;
                const childId = inclusionChildId(nodeId);
                setRemoveAsk(null);
                if (childId) {
                  setSelection({ kind: 'inclusion', id: childId });
                  return;
                }
                setSelection({ kind: 'node', id: nodeId });
                void library.loadNode(nodeId);
              }}
              onSelectLink={(edgeId) => {
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
              双击空白添加文字 · 拖入图片 · 拖动点 · 从圆点拖线或按 L 连线 · 选中点后 Tab 建下级、Enter 建同级 · 工具栏或右键可插入子集合
            </p>
          ) : null}
          {session.canvasError !== '' || library.error !== '' ? (
            <p role="alert" className="canvas-error">
              {session.canvasError !== '' ? session.canvasError : library.error}
            </p>
          ) : null}
        </div>
        {selection?.kind === 'node' ? (
          <NodePanel
            collectionId={id}
            nodeId={selection.id}
            askRemove={removeAsk?.kind === 'node' && removeAsk.id === selection.id ? removeAsk.token : 0}
            onLeave={leave}
            onTouched={() => void refresh()}
          />
        ) : null}
        {selection?.kind === 'edge' ? (
          <EdgePanel
            edgeId={selection.id}
            askRemove={removeAsk?.kind === 'edge' && removeAsk.id === selection.id ? removeAsk.token : 0}
            onLeave={leave}
            onTouched={() => void refresh()}
          />
        ) : null}
      </div>
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

function createdNodeId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('id' in data)) return null;
  const id = data.id;
  return typeof id === 'string' && id !== '' ? id : null;
}
