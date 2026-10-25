import { observer, useService } from '@rabjs/react';
import type { CardType } from '@unfold/dto';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BoardCanvas } from '../components/board-canvas.js';
import { CardStack } from '../components/card-stack.js';
import { NameField } from '../components/name-field.js';
import { UButton } from '../components/ui/button.js';
import { IconClose } from '../components/ui/icons.js';
import { UConfirm } from '../components/ui/modal.js';
import { USelect } from '../components/ui/select.js';
import { emptyCard } from '../lib/empty-card.js';
import { LibraryService } from '../services/library.service.js';

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

function PanelShell(props: { title: string; onLeave: () => void; children: React.ReactNode }) {
  return (
    <aside className="board-panel">
      <div className="panel-head">
        <span className="panel-title">{props.title}</span>
        <button type="button" className="ibtn" aria-label="关闭" onClick={props.onLeave}>
          <IconClose />
        </button>
      </div>
      <div className="panel-scroll">{props.children}</div>
    </aside>
  );
}

const CollectionPanel = observer(function CollectionPanel(props: {
  id: string;
  title: string;
  onOpen: () => void;
  onAskDelete: () => void;
  onSelectEdge: (id: string) => void;
  onLeave: () => void;
}) {
  const library = useService(LibraryService);
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const others = library.collections.filter((item) => item.id !== props.id);
  const touching = (library.libraryGraph?.edges ?? []).filter(
    (edge) => edge.fromId === props.id || edge.toId === props.id,
  );

  useEffect(() => {
    setTarget('');
    setLabel('');
  }, [props.id]);

  return (
    <PanelShell title={props.title} onLeave={props.onLeave}>
      <NameField
        id={props.id}
        label="标题"
        value={props.title}
        onSave={(value) => {
          void library.renameCollection(props.id, value);
        }}
      />
      <div className="panel-actions" style={{ marginTop: 0 }}>
        <UButton variant="primary" onClick={props.onOpen}>
          打开
        </UButton>
        <UButton variant="danger" onClick={props.onAskDelete}>
          删除合集
        </UButton>
      </div>
      <div className="panel-block">
        <p className="panel-h">连接到</p>
        {others.length === 0 ? (
          <p className="muted">还没有其他合集</p>
        ) : (
          <div className="connect-row">
            <USelect
              ariaLabel="连到哪个合集"
              placeholder="另一个合集"
              value={target}
              options={others.map((item) => ({ value: item.id, label: item.title }))}
              onChange={setTarget}
            />
            <input
              className="tf"
              aria-label="关系"
              placeholder="例如：相关"
              maxLength={40}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <UButton
              variant="primary"
              disabled={target === '' || label.trim() === ''}
              onClick={() => {
                void (async () => {
                  const created = await library.createCollectionEdge(props.id, target, label);
                  if (!created) return;
                  setLabel('');
                  await library.loadLibrary();
                  props.onSelectEdge(created.id);
                })();
              }}
            >
              连上
            </UButton>
          </div>
        )}
        {touching.length > 0 ? (
          <ul className="edge-list">
            {touching.map((edge) => {
              const otherId = edge.fromId === props.id ? edge.toId : edge.fromId;
              const other = library.collections.find((item) => item.id === otherId);
              return (
                <li key={edge.id}>
                  <button type="button" onClick={() => props.onSelectEdge(edge.id)}>
                    {other?.title ?? '合集'} · {edge.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </PanelShell>
  );
});

const CollectionEdgePanel = observer(function CollectionEdgePanel(props: {
  id: string;
  onLeave: () => void;
  onDeleted: () => void;
}) {
  const library = useService(LibraryService);
  const [confirm, setConfirm] = useState(false);
  const detail = library.collectionEdgeDetail?.id === props.id ? library.collectionEdgeDetail : null;

  async function reload() {
    await library.loadCollectionEdge(props.id);
    await library.loadLibrary();
  }

  return (
    <PanelShell title="合集关系" onLeave={props.onLeave}>
      {!detail ? <p className="muted">正在读取…</p> : null}
      {detail ? (
        <>
          <p className="panel-kicker">
            {detail.fromTitle}
            <span className="arrow">→</span>
            {detail.toTitle}
          </p>
          <NameField
            id={detail.id}
            label="关系"
            maxLength={40}
            value={detail.label}
            onSave={(value) => {
              void library.renameCollectionEdge(detail.id, value);
            }}
          />
          <CardStack
            cards={detail.cards}
            onCreate={(type: CardType) => {
              void (async () => {
                const created = await library.createCard(emptyCard('collection_edge', detail.id, type));
                if (created) await reload();
              })();
            }}
            onUpdate={(id, content) => {
              void library.updateCard(id, content);
            }}
            onDelete={(id) => {
              void library.deleteCard(id);
            }}
          />
          <div className="panel-actions">
            <UButton variant="danger" onClick={() => setConfirm(true)}>
              删除关系
            </UButton>
          </div>
        </>
      ) : null}
      {confirm ? (
        <UConfirm
          title="删除关系"
          body="这条合集之间的关系会去掉，挂在上面的卡片也一起去掉。"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void (async () => {
              const ok = await library.deleteCollectionEdge(props.id);
              if (ok) props.onDeleted();
            })();
          }}
        />
      ) : null}
    </PanelShell>
  );
});
