import { observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BoardCanvas } from '../board/board-canvas.js';
import { LibraryService } from '../library/library.service.js';
import { EdgePanel } from './edge-panel.js';
import { NodePanel } from './node-panel.js';
import { NodePeek } from './node-peek.js';

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

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
