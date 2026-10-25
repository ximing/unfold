import { observer, useService } from '@rabjs/react';
import type { Card, CardType } from '@unfold/dto';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BoardCanvas } from '../components/board-canvas.js';
import { CardStack } from '../components/card-stack.js';
import { NameField } from '../components/name-field.js';
import { UButton } from '../components/ui/button.js';
import { UTextArea } from '../components/ui/field.js';
import { IconClose } from '../components/ui/icons.js';
import { UConfirm } from '../components/ui/modal.js';
import { USelect } from '../components/ui/select.js';
import { toast } from '../components/ui/toast.js';
import { cardMeta } from '../lib/card-meta.js';
import { emptyCard } from '../lib/empty-card.js';
import { LibraryService } from '../services/library.service.js';

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 悬停预览里的一段摘录：第一张有字的卡片 */
function peekText(cards: Card[]): string {
  for (const card of cards) {
    const joined = Object.values(card.content)
      .map((value) => stripHtml(value))
      .filter((value) => value !== '')
      .join(' · ');
    if (joined !== '') {
      const chars = [...joined];
      return chars.length <= 90 ? joined : `${chars.slice(0, 89).join('')}…`;
    }
  }
  return '';
}

const NodePeek = observer(function NodePeek(props: { nodeId: string; name: string; count: number }) {
  const library = useService(LibraryService);
  const peek = library.peek?.id === props.nodeId ? library.peek : null;
  const snippet = peek ? peekText(peek.cards) : '';
  const types = peek ? [...new Set(peek.cards.map((card) => card.type))] : [];
  const description = peek?.description?.trim() ?? '';
  return (
    <div className="bpeek-card">
      <p className="pk-name">
        {props.name}
        <span className="pk-cnt">{props.count > 0 ? `${props.count} 张卡片` : ''}</span>
      </p>
      {description !== '' ? <p className="pk-desc">{description}</p> : null}
      {types.length > 0 ? (
        <p className="pk-dots">
          {types.map((type) => (
            <i key={type} style={{ background: cardMeta(type).hue }} />
          ))}
        </p>
      ) : null}
      {!peek ? <p className="pk-none">正在读取…</p> : snippet !== '' ? <p className="pk-text">{snippet}</p> : null}
      {peek && snippet === '' && types.length === 0 ? <p className="pk-none">还没有卡片</p> : null}
    </div>
  );
});

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
  if (id !== seenId) {
    setSeenId(id);
    setReady(false);
    setMissing(false);
    setSelection(null);
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
  const title = library.collections.find((item) => item.id === id)?.title ?? '';

  async function refresh() {
    await Promise.all([library.loadGraph(id as string), library.loadCollections()]);
  }

  function leave() {
    setSelection(null);
    void refresh();
  }

  return (
    <div className="board-stage">
      <div className="board-frame">
        <div className="board-canvas">
          {!ready ? <p className="muted board-wait">正在读取…</p> : null}
          {ready ? (
            <BoardCanvas
              items={nodes.map((node) => ({
                id: node.id,
                label: node.name,
                description: node.description,
                count: node.cardCount,
                types: node.cardTypes,
              }))}
              links={edges}
              selectedId={selection?.id ?? null}
              createPlaceholder="点的名字"
              onCreate={(name) => {
                void (async () => {
                  const created = await library.createNode(id as string, name);
                  if (!created) return;
                  await refresh();
                  setSelection({ kind: 'node', id: created.id });
                  await library.loadNode(created.id);
                })();
              }}
              onRenameItem={(nodeId, name) => {
                void library.renameNode(nodeId, name);
              }}
              onConnect={(fromId, toId, label) => {
                void (async () => {
                  const created = await library.createEdge(fromId, toId, label);
                  if (!created) return;
                  await refresh();
                  setSelection({ kind: 'edge', id: created.id });
                  await library.loadEdge(created.id);
                })();
              }}
              renderPeek={(nodeId) => {
                const node = nodes.find((entry) => entry.id === nodeId);
                if (!node) return null;
                return <NodePeek nodeId={nodeId} name={node.name} count={node.cardCount} />;
              }}
              onPeekItem={(nodeId) => {
                if (nodeId) void library.loadPeek(nodeId);
                else library.clearPeek();
              }}
              onEscape={() => setSelection(null)}
              onSelectItem={(nodeId) => {
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
          <div className="canvas-chip">
            {title || '合集'}
            <span className="cnt">{nodes.length} 点</span>
          </div>
          {ready && nodes.length <= 2 ? (
            <p className="canvas-hint">双击空白添加点 · 拖动圆点连线 · 双击改名 · 方向键选中</p>
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

const NodePanel = observer(function NodePanel(props: {
  collectionId: string;
  nodeId: string;
  onLeave: () => void;
  onTouched: () => void;
}) {
  const library = useService(LibraryService);
  const [targetCollection, setTargetCollection] = useState('');
  const [confirm, setConfirm] = useState(false);
  const detail = library.nodeDetail?.id === props.nodeId ? library.nodeDetail : null;
  const [descDraft, setDescDraft] = useState('');

  useEffect(() => {
    setTargetCollection('');
    setDescDraft(detail?.description ?? '');
     
  }, [props.nodeId, detail?.id, detail?.description]);

  const memberIds = new Set(detail?.collections.map((item) => item.id) ?? []);
  const others = library.collections.filter((item) => !memberIds.has(item.id));

  return (
    <PanelShell title={detail?.name ?? '点'} onLeave={props.onLeave}>
      {!detail ? <p className="muted">正在读取…</p> : null}
      {detail ? (
        <>
          <NameField
            id={detail.id}
            label="名字"
            value={detail.name}
            onSave={(value) => {
              void library.renameNode(detail.id, value);
            }}
          />
          <div className="field">
            <label htmlFor={`desc-${detail.id}`}>描述</label>
            <UTextArea
              id={`desc-${detail.id}`}
              className="desc-tf"
              placeholder="一句话，图上会直接显示"
              maxLength={160}
              value={descDraft}
              onChange={(event) => setDescDraft(event.target.value)}
              onBlur={() => {
                const next = descDraft.trim();
                if (next !== detail.description) void library.describeNode(detail.id, next);
              }}
            />
          </div>
          <CardStack
            cards={detail.cards}
            onCreate={(type: CardType) => {
              void (async () => {
                const created = await library.createCard(emptyCard('node', detail.id, type));
                if (!created) return;
                await library.loadNode(detail.id);
                props.onTouched();
              })();
            }}
            onUpdate={(cardId, content) => {
              void library.updateCard(cardId, content);
            }}
            onDelete={(cardId) => {
              void (async () => {
                const ok = await library.deleteCard(cardId);
                if (ok) props.onTouched();
              })();
            }}
          />
          <div className="panel-block">
            <p className="panel-h">也放入</p>
            {others.length === 0 ? (
              <p className="muted">已经在所有合集里</p>
            ) : (
              <div className="connect-row">
                <USelect
                  ariaLabel="放入哪个合集"
                  placeholder="选择合集"
                  value={targetCollection}
                  options={others.map((item) => ({ value: item.id, label: item.title }))}
                  onChange={setTargetCollection}
                />
                <UButton
                  disabled={targetCollection === ''}
                  onClick={() => {
                    void (async () => {
                      const ok = await library.addMember(targetCollection, detail.id);
                      if (!ok) return;
                      setTargetCollection('');
                      toast('已放入');
                      await library.loadNode(detail.id);
                    })();
                  }}
                >
                  放入
                </UButton>
              </div>
            )}
          </div>
          <div className="panel-actions">
            <UButton
              onClick={() => {
                void (async () => {
                  const ok = await library.removeMember(props.collectionId, detail.id);
                  if (ok) props.onLeave();
                })();
              }}
            >
              移出这个合集
            </UButton>
            <UButton variant="danger" onClick={() => setConfirm(true)}>
              删除这个点
            </UButton>
          </div>
        </>
      ) : null}
      {confirm ? (
        <UConfirm
          title="删除这个点"
          body="这个点会去掉，连着它的关系也会去掉。"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void (async () => {
              const ok = await library.deleteNode(props.nodeId);
              if (ok) props.onLeave();
            })();
          }}
        />
      ) : null}
    </PanelShell>
  );
});

const EdgePanel = observer(function EdgePanel(props: { edgeId: string; onLeave: () => void; onTouched: () => void }) {
  const library = useService(LibraryService);
  const [confirm, setConfirm] = useState(false);
  const detail = library.edgeDetail?.id === props.edgeId ? library.edgeDetail : null;

  return (
    <PanelShell title="关系" onLeave={props.onLeave}>
      {!detail ? <p className="muted">正在读取…</p> : null}
      {detail ? (
        <>
          <p className="panel-kicker">
            {detail.fromName}
            <span className="arrow">→</span>
            {detail.toName}
          </p>
          <NameField
            id={detail.id}
            label="关系"
            maxLength={40}
            value={detail.label}
            onSave={(value) => {
              void library.renameEdge(detail.id, value);
            }}
          />
          <CardStack
            cards={detail.cards}
            onCreate={(type: CardType) => {
              void (async () => {
                const created = await library.createCard(emptyCard('edge', detail.id, type));
                if (!created) return;
                await library.loadEdge(detail.id);
                props.onTouched();
              })();
            }}
            onUpdate={(cardId, content) => {
              void library.updateCard(cardId, content);
            }}
            onDelete={(cardId) => {
              void (async () => {
                const ok = await library.deleteCard(cardId);
                if (ok) props.onTouched();
              })();
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
          body="这条关系会去掉，挂在上面的卡片也一起去掉。"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void (async () => {
              const ok = await library.deleteEdge(props.edgeId);
              if (ok) props.onLeave();
            })();
          }}
        />
      ) : null}
    </PanelShell>
  );
});
