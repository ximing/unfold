import { observer, useService } from '@rabjs/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BoardCanvas } from '../board/board-canvas.js';
import { imageDropSpots, imageFileIssue } from '../board/image-intake.js';
import { isFiniteNumber, layoutBoard, nextPlacementZ } from '../board/board-layout.js';
import { apiSend, errorMessage } from '../library/api.js';
import { LibraryService } from '../library/library.service.js';
import { EdgePanel } from './edge-panel.js';
import { NodePanel } from './node-panel.js';
import { NodePeek } from './node-peek.js';

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

type UploadSpot = { id: string; label: string; x: number; y: number; z: number };

export const CollectionPage = observer(function CollectionPage() {
  const library = useService(LibraryService);
  const { id } = useParams();
  const [params] = useSearchParams();
  const nodeQuery = params.get('node') ?? '';
  const edgeQuery = params.get('edge') ?? '';
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [seenId, setSeenId] = useState(id);
  const [uploads, setUploads] = useState<UploadSpot[]>([]);
  const uploadsRef = useRef<UploadSpot[]>([]);
  const pageIdRef = useRef(id);
  const intakeQueue = useRef(Promise.resolve());
  const placeTried = useRef(new Set<string>());
  pageIdRef.current = id;
  if (id !== seenId) {
    setSeenId(id);
    setReady(false);
    setMissing(false);
    setSelection(null);
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
    if (nodes.length === 0 || nodes.some((node) => isFiniteNumber(node.x))) return;
    const key = `${id}:all`;
    if (placeTried.current.has(key)) return;
    placeTried.current.add(key);
    const boxes = layoutBoard(
      nodes.map((node) => ({ id: node.id })),
      library.graph.edges.map((edge) => ({ fromId: edge.fromId, toId: edge.toId })),
    );
    void library.savePlacements(
      id,
      boxes.map((box, index) => ({ nodeId: box.id, x: box.x, y: box.y, z: index })),
    );
  }, [ready, id, library, library.graph, library.graphId]);

  if (!id || missing) {
    return (
      <div className="board-stage">
        <p className="board-missing">这个合集没有找到</p>
        <Link to="/library">回到全貌</Link>
      </div>
    );
  }

  const current = library.graphId === id;
  const nodes = current ? library.graph.nodes : [];
  const edges = current ? library.graph.edges : [];

  async function refresh() {
    await Promise.all([library.loadGraph(id as string), library.loadCollections()]);
  }

  function leave() {
    setSelection(null);
    void refresh();
  }

  async function insertImages(files: File[], at: { x: number; y: number }, anchor: 'center' | 'corner') {
    if (!id || pageIdRef.current !== id) return;
    const collectionId = id;
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
    if (library.graphId === collectionId) {
      for (const node of library.graph.nodes) {
        if (isFiniteNumber(node.x) && isFiniteNumber(node.y)) occupied.push({ x: node.x, y: node.y });
      }
    }
    for (const item of uploadsRef.current) occupied.push({ x: item.x, y: item.y });
    const spots = imageDropSpots(anchor, at, good.length, occupied);
    let z = nextPlacementZ([
      ...(library.graphId === collectionId ? library.graph.nodes.map((node) => node.z) : []),
      ...uploadsRef.current.map((item) => item.z),
    ]);
    const batch: { spot: UploadSpot; file: File }[] = [];
    for (let index = 0; index < good.length; index += 1) {
      const file = good[index];
      const spot = spots[index];
      if (!file || !spot) continue;
      batch.push({
        file,
        spot: { id: `uploading:${crypto.randomUUID()}`, label: file.name, x: spot.x, y: spot.y, z },
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
      const posted = await postCollectionImage(collectionId, item.file, startedX, startedY);
      if (pageIdRef.current !== collectionId) return;
      const latest = uploadsRef.current.find((entry) => entry.id === item.spot.id);
      const finalX = latest?.x ?? startedX;
      const finalY = latest?.y ?? startedY;
      uploadsRef.current = uploadsRef.current.filter((entry) => entry.id !== item.spot.id);
      setUploads(uploadsRef.current);
      if (!posted.ok) {
        if (failure === '') failure = posted.message;
        continue;
      }
      await library.loadGraph(collectionId);
      if (pageIdRef.current !== collectionId) return;
      if (finalX !== startedX || finalY !== startedY) {
        const node = library.graph.nodes.find((entry) => entry.id === posted.id);
        const nodeZ = node && isFiniteNumber(node.z) ? node.z : 0;
        const saved = await library.savePlacements(collectionId, [{ nodeId: posted.id, x: finalX, y: finalY, z: nodeZ }]);
        if (pageIdRef.current !== collectionId) return;
        if (!saved && placementError === '') placementError = library.error;
      }
    }
    if (pageIdRef.current !== collectionId) return;
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
                ...nodes.map((node) => ({
                  id: node.id,
                  label: node.name,
                  description: node.description,
                  count: node.cardCount,
                  types: node.cardTypes,
                  x: node.x,
                  y: node.y,
                  z: node.z,
                  kind: node.kind,
                  assetId: node.assetId,
                  imageWidth: node.imageWidth,
                })),
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
              links={edges}
              selectedId={selection?.id ?? null}
              createPlaceholder="点的名字"
              onGrowBlocked={(message) => {
                library.error = message;
              }}
              onGrowNode={(draft) => {
                void (async () => {
                  if (!id || pageIdRef.current !== id) return;
                  const collectionId = id;
                  const created = await library.createNode(collectionId, draft.name);
                  if (!created || pageIdRef.current !== collectionId) return;
                  placeTried.current.add(`${collectionId}:node:${created.id}`);
                  const z = nextPlacementZ(library.graph.nodes.map((node) => node.z));
                  const saved = await library.savePlacements(collectionId, [
                    { nodeId: created.id, x: draft.x, y: draft.y, z },
                  ]);
                  const placementError = saved ? '' : library.error;
                  if (pageIdRef.current !== collectionId) return;
                  await refresh();
                  if (pageIdRef.current !== collectionId) return;
                  setSelection({ kind: 'node', id: created.id });
                  await library.loadNode(created.id);
                  if (pageIdRef.current !== collectionId) return;
                  if (placementError !== '') library.error = placementError;
                })();
              }}
              onCreate={(name, at) => {
                void (async () => {
                  const created = await library.createNode(id, name);
                  if (!created) return;
                  placeTried.current.add(`${id}:node:${created.id}`);
                  const z = nextPlacementZ(library.graph.nodes.map((node) => node.z));
                  const saved = await library.savePlacements(id, [
                    { nodeId: created.id, x: at.x - 84, y: at.y - 28, z },
                  ]);
                  const placementError = saved ? '' : library.error;
                  await refresh();
                  setSelection({ kind: 'node', id: created.id });
                  await library.loadNode(created.id);
                  if (placementError !== '') library.error = placementError;
                })();
              }}
              onInsertImages={(files, at, anchor) => {
                const job = intakeQueue.current.then(() => insertImages(files, at, anchor));
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
                return library.savePlacements(id, [{ nodeId, x, y, z }]);
              }}
              onResizeImage={(nodeId, imageWidth) => {
                if (nodeId.startsWith('uploading:')) return false;
                const node = library.graph.nodes.find((entry) => entry.id === nodeId);
                if (!node || !isFiniteNumber(node.x) || !isFiniteNumber(node.y)) return false;
                return library.savePlacements(id, [
                  { nodeId, x: node.x, y: node.y, z: isFiniteNumber(node.z) ? node.z : 0, imageWidth },
                ]);
              }}
              onPlaceUnpositioned={(spots) => {
                const fresh = spots.filter((spot) => !placeTried.current.has(`${id}:node:${spot.id}`));
                if (fresh.length === 0) return;
                const key = `${id}:part:${[...fresh.map((spot) => spot.id)].sort().join(',')}`;
                if (placeTried.current.has(key)) return;
                placeTried.current.add(key);
                for (const spot of fresh) placeTried.current.add(`${id}:node:${spot.id}`);
                const z0 = nextPlacementZ(library.graph.nodes.map((node) => node.z));
                void library.savePlacements(
                  id,
                  fresh.map((spot, index) => ({ nodeId: spot.id, x: spot.x, y: spot.y, z: z0 + index })),
                );
              }}
              onRenameItem={(nodeId, name) => {
                if (nodeId.startsWith('uploading:')) return;
                void library.renameNode(nodeId, name);
              }}
              enableTools
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
                const current = edges.find((edge) => edge.id === edgeId);
                if (!current || next === current.label) return;
                void library.renameEdge(edgeId, next);
              }}
              renderPeek={(nodeId) => {
                const node = nodes.find((entry) => entry.id === nodeId);
                if (!node) return null;
                return <NodePeek nodeId={nodeId} name={node.name} count={node.cardCount} />;
              }}
              onPeekItem={(nodeId) => {
                if (nodeId?.startsWith('uploading:')) return;
                if (nodeId) void library.loadPeek(nodeId);
                else library.clearPeek();
              }}
              onEscape={() => setSelection(null)}
              onSelectItem={(nodeId) => {
                if (nodeId.startsWith('uploading:')) return;
                setSelection({ kind: 'node', id: nodeId });
                void library.loadNode(nodeId);
              }}
              onSelectLink={(edgeId) => {
                setSelection({ kind: 'edge', id: edgeId });
                void library.loadEdge(edgeId);
              }}
            />
          ) : null}
          {ready && nodes.length === 0 ? (
            <div className="board-empty">
              <p className="muted">先添加一个点</p>
            </div>
          ) : null}
          {ready && nodes.length <= 2 ? (
            <p className="canvas-hint">双击空白添加文字 · 拖入图片 · 拖动点 · 拖动手柄或按 L 连线 · 选中点后 Tab 建下级、Enter 建同级</p>
          ) : null}
          {library.error !== '' ? <p role="alert" className="canvas-error">{library.error}</p> : null}
        </div>
        {selection?.kind === 'node' ? (
          <NodePanel collectionId={id} nodeId={selection.id} onLeave={leave} onTouched={() => void refresh()} />
        ) : null}
        {selection?.kind === 'edge' ? (
          <EdgePanel edgeId={selection.id} onLeave={leave} onTouched={() => void refresh()} />
        ) : null}
      </div>
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
