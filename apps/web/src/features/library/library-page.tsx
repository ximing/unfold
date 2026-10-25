import { observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { BoardCanvas } from '../board/board-canvas.js';
import { CollectionEdgePanel } from './collection-edge-panel.js';
import { CollectionPanel } from './collection-panel.js';
import { LibraryService } from './library.service.js';

type Selection = { kind: 'collection'; id: string } | { kind: 'edge'; id: string } | null;

export const LibraryPage = observer(function LibraryPage() {
  const library = useService(LibraryService);
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    if (selection?.kind !== 'edge') return;
    void library.loadCollectionEdge(selection.id);
  }, [library, selection]);

  const graph = library.libraryGraph;
  const collections = graph?.collections ?? [];
  const edges = graph?.edges ?? [];
  const selectedCollection = selection?.kind === 'collection' ? collections.find((item) => item.id === selection.id) : null;
  const selectedEdge = selection?.kind === 'edge' ? edges.find((item) => item.id === selection.id) : null;

  return (
    <div className="board-stage">
      <div className="board-frame">
        <div className="board-canvas">
          {!ready ? <p className="muted board-wait">正在读取…</p> : null}
          {ready ? (
            <BoardCanvas
              items={collections.map((item) => ({ id: item.id, label: item.title, count: item.nodeCount }))}
              links={edges.map((edge) => ({ ...edge, count: edge.cardCount }))}
              selectedId={selection?.id ?? null}
              createPlaceholder="合集标题"
              onCreate={(title) => {
                void (async () => {
                  const created = await library.createCollection(title);
                  if (!created) return;
                  await library.loadLibrary();
                  setSelection({ kind: 'collection', id: created.id });
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
              onSelectItem={(id) => setSelection({ kind: 'collection', id })}
              onSelectLink={(id) => setSelection({ kind: 'edge', id })}
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
          <div className="canvas-chip">
            合集全貌
            <span className="cnt">{collections.length} 合集</span>
          </div>
          {ready && collections.length > 0 && collections.length <= 3 ? (
            <p className="canvas-hint">双击空白新建 · 拖动圆点连线 · 双击打开 · 方向键选中</p>
          ) : null}
          {library.error !== '' ? <p role="alert" className="canvas-error">{library.error}</p> : null}
        </div>
        {selectedCollection ? (
          <CollectionPanel
            id={selectedCollection.id}
            title={selectedCollection.title}
            onOpen={() => navigate(`/c/${selectedCollection.id}`)}
            onAskDelete={() => setConfirmDelete(true)}
            onSelectEdge={(id) => setSelection({ kind: 'edge', id })}
            onLeave={() => setSelection(null)}
          />
        ) : null}
        {selectedEdge ? (
          <CollectionEdgePanel
            id={selectedEdge.id}
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
