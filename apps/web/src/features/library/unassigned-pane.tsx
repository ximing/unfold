import type { UnassignedNode } from '@unfold/dto';
import { useEffect, useState } from 'react';
import { fetchUnassigned } from './unassigned.js';
import './unassigned-pane.css';

function metaOf(node: UnassignedNode): string {
  if (node.kind === 'image') return '图片';
  if (node.cardCount > 0) return `${node.cardCount} 卡片`;
  return '';
}

export function UnassignedPane(props: { selectedId: string; reloadTick: number; onOpen: (id: string) => void }) {
  const [nodes, setNodes] = useState<UnassignedNode[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    setPhase('loading');
    void fetchUnassigned().then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setPhase('error');
        return;
      }
      setNodes(result.nodes);
      setCursor(result.nextCursor);
      setPhase('ready');
    });
    return () => {
      alive = false;
    };
  }, [props.reloadTick]);

  async function loadMore() {
    if (!cursor) return;
    const result = await fetchUnassigned(cursor);
    if (!result.ok) {
      setPhase('error');
      return;
    }
    setNodes((prev) => [...prev, ...result.nodes]);
    setCursor(result.nextCursor);
    setPhase('ready');
  }

  return (
    <aside className="unassigned-pane" aria-label="未归入合集">
      <div className="unassigned-head">
        <h2>
          未归入合集
          {phase === 'ready' ? <span className="n">{nodes.length} 点</span> : null}
        </h2>
      </div>
      <div className="unassigned-list">
        {phase === 'loading' ? <p className="unassigned-status">正在读取…</p> : null}
        {phase === 'error' ? (
          <p className="unassigned-status" role="alert">
            没有加载出来
          </p>
        ) : null}
        {phase === 'ready' && nodes.length === 0 ? <p className="unassigned-status">没有未归入的点</p> : null}
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={props.selectedId === node.id ? 'unassigned-item on' : 'unassigned-item'}
            aria-pressed={props.selectedId === node.id}
            onClick={() => props.onOpen(node.id)}
          >
            <span className="unassigned-dot" aria-hidden />
            <span className="unassigned-name">{node.name}</span>
            <span className="unassigned-meta">{metaOf(node)}</span>
          </button>
        ))}
      </div>
      {cursor ? (
        <button type="button" className="unassigned-more" onClick={() => void loadMore()}>
          加载更多
        </button>
      ) : null}
    </aside>
  );
}
