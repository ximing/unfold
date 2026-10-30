import { observer, useService } from '@rabjs/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { BoardCanvas } from '../board/board-canvas.js';
import { EdgePanel } from '../collection/edge-panel.js';
import { NodePanel } from '../collection/node-panel.js';
import { writeCollectionView } from '../outline/collection-view.js';
import { SessionService } from '../session/session.service.js';
import { CollectionEdgePanel } from './collection-edge-panel.js';
import { CollectionPanel } from './collection-panel.js';
import { LibraryService } from './library.service.js';
import { UnassignedPane } from './unassigned-pane.js';

type Selection = { kind: 'collection'; id: string } | { kind: 'edge'; id: string } | null;

export const LibraryPage = observer(function LibraryPage() {
  const library = useService(LibraryService);
  const session = useService(SessionService);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const nodeQuery = params.get('node') ?? '';
  const linkQuery = params.get('link') ?? '';
  const collectionEdgeQuery = params.get('collectionEdge') ?? '';
  const cardQuery = params.get('card') ?? '';
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [unassignedTick, setUnassignedTick] = useState(0);
  const removeToken = useRef(0);
  const [edgeAsk, setEdgeAsk] = useState<{ id: string; token: number } | null>(null);

  function closeQuery(keys: string[]) {
    const next = new URLSearchParams(params);
    for (const key of keys) next.delete(key);
    setParams(next, { replace: true });
  }

  function clearQuery() {
    if (nodeQuery === '' && linkQuery === '' && collectionEdgeQuery === '' && cardQuery === '') return;
    setParams({}, { replace: true });
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      await library.loadLibrary();
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [library]);

  useEffect(() => {
    if (nodeQuery === '') return;
    void library.loadNode(nodeQuery);
  }, [library, nodeQuery]);

  useEffect(() => {
    if (linkQuery === '') return;
    void library.loadEdge(linkQuery);
  }, [library, linkQuery]);

  useEffect(() => {
    const edgeId = collectionEdgeQuery || (selection?.kind === 'edge' ? selection.id : '');
    if (edgeId === '') return;
    void library.loadCollectionEdge(edgeId);
  }, [collectionEdgeQuery, library, selection]);

  useEffect(() => {
    library.watchView({
      kind: 'library',
      edgeId: selection?.kind === 'edge' ? selection.id : null,
    });
    return () => library.watchView(null);
  }, [library, selection]);

  const graph = library.libraryGraph;
  const collections = graph?.collections ?? [];
  const edges = graph?.edges ?? [];
  const selectedCollection = selection?.kind === 'collection' ? collections.find((item) => item.id === selection.id) : null;
  const selectedEdge = selection?.kind === 'edge' ? edges.find((item) => item.id === selection.id) : null;

  return (
    <div className="board-stage">
      <div className="board-frame">
        <UnassignedPane
          selectedId={nodeQuery}
          reloadTick={unassignedTick}
          onOpen={(nodeId) => {
            setSelection(null);
            setParams({ node: nodeId }, { replace: true });
          }}
        />
        <div className="board-canvas">
          {!ready ? <p className="muted board-wait">正在读取…</p> : null}
          {ready ? (
            <BoardCanvas
              canvas={session.canvas}
              items={collections.map((item) => ({ id: item.id, label: item.title, count: item.nodeCount }))}
              links={edges.map((edge) => ({ ...edge, count: edge.cardCount }))}
              selectedId={selection?.id ?? null}
              createPlaceholder="合集标题"
              onCreate={(title) => {
                void (async () => {
                  const created = await library.createCollection(title);
                  if (!created) return;
                  writeCollectionView(created.id, 'outline');
                  navigate(`/c/${created.id}`);
                })();
              }}
              onOpenItem={(id) => navigate(`/c/${id}`)}
              onConnect={(fromId, toId, label) => {
                void (async () => {
                  const created = await library.createCollectionEdge(fromId, toId, label);
                  if (!created) return;
                  await library.loadLibrary();
                  setSelection({ kind: 'edge', id: created.id });
                  void library.loadCollectionEdge(created.id);
                })();
              }}
              onSelectItem={(id) => {
                clearQuery();
                setConfirmDelete(false);
                setSelection({ kind: 'collection', id });
              }}
              onSelectLink={(id) => {
                clearQuery();
                setEdgeAsk(null);
                setSelection({ kind: 'edge', id });
              }}
              onAskRemoveItem={(id) => {
                setSelection({ kind: 'collection', id });
                setConfirmDelete(true);
              }}
              onAskRemoveLink={(id) => {
                removeToken.current += 1;
                setSelection({ kind: 'edge', id });
                setEdgeAsk({ id, token: removeToken.current });
              }}
              onEscape={() => setSelection(null)}
            />
          ) : null}
          {ready && collections.length === 0 ? (
            <div className="board-empty">
              <p className="muted">还没有合集</p>
              <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                双击任意处，放下第一个合集
              </p>
            </div>
          ) : null}
          {ready && collections.length > 0 && collections.length <= 3 ? (
            <p className="canvas-hint">双击空白新建 · 拖动圆点连线 · 双击打开 · 方向键选中</p>
          ) : null}
          {library.error !== '' ? <p role="alert" className="canvas-error">{library.error}</p> : null}
        </div>
        {nodeQuery !== '' ? (
          <NodePanel
            collectionId={null}
            nodeId={nodeQuery}
            focusCardId={cardQuery || null}
            onLeave={() => closeQuery(['node', 'card'])}
            onTouched={() => {
              setUnassignedTick((value) => value + 1);
              void library.loadNode(nodeQuery);
            }}
          />
        ) : linkQuery !== '' ? (
          <EdgePanel
            edgeId={linkQuery}
            focusCardId={cardQuery || null}
            onLeave={() => closeQuery(['link', 'card'])}
            onTouched={() => void library.loadEdge(linkQuery)}
          />
        ) : collectionEdgeQuery !== '' ? (
          <CollectionEdgePanel
            id={collectionEdgeQuery}
            focusCardId={cardQuery || null}
            onLeave={() => closeQuery(['collectionEdge', 'card'])}
            onDeleted={() => {
              closeQuery(['collectionEdge', 'card']);
              void library.loadLibrary();
            }}
          />
        ) : selectedCollection ? (
          <CollectionPanel
            id={selectedCollection.id}
            title={selectedCollection.title}
            onOpen={() => navigate(`/c/${selectedCollection.id}`)}
            onAskDelete={() => setConfirmDelete(true)}
            onSelectEdge={(id) => setSelection({ kind: 'edge', id })}
            onLeave={() => setSelection(null)}
          />
        ) : selectedEdge ? (
          <CollectionEdgePanel
            id={selectedEdge.id}
            askRemove={edgeAsk?.id === selectedEdge.id ? edgeAsk.token : 0}
            onLeave={() => setSelection(null)}
            onDeleted={() => {
              setSelection(null);
              void library.loadLibrary();
            }}
          />
        ) : null}
      </div>
      {confirmDelete && selectedCollection ? (
        <UConfirm
          title="删除合集"
          body="这个合集会从列表里消失。点如果还在别的合集里，会留着。"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            const id = selectedCollection.id;
            setConfirmDelete(false);
            void (async () => {
              const ok = await library.deleteCollection(id);
              if (!ok) return;
              setSelection(null);
              await library.loadLibrary();
            })();
          }}
        />
      ) : null}
    </div>
  );
});
