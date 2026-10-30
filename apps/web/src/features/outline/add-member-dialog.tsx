import { useService } from '@rabjs/react';
import type { SearchHit } from '@unfold/dto';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchSearch } from '../library/search.js';
import { LibraryService } from '../library/library.service.js';
import { UButton } from '../../shared/ui/button/button.js';
import './add-member-dialog.css';

const SHARE_NOTE = '名称和正文是同一个点，改了到处一起变。大纲位置和画布位置只属于这个合集。';

export function AddMemberDialog(props: {
  collectionId: string;
  parentId: string | null;
  onClose: () => void;
  onDone: (status: 'joined' | 'exists', nodeId: string) => void;
}) {
  const library = useService(LibraryService);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SearchHit[]>([]);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [props]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      setRows([]);
      setPhase('idle');
      return;
    }
    let alive = true;
    setPhase('loading');
    const timer = window.setTimeout(() => {
      void fetchSearch({ query: trimmed, scope: 'account' }).then((result) => {
        if (!alive) return;
        if (!result.ok) {
          setRows([]);
          setPhase('error');
          return;
        }
        const seen = new Set<string>();
        const nodes: SearchHit[] = [];
        for (const hit of result.body.hits) {
          if (hit.kind !== 'node' || seen.has(hit.id)) continue;
          seen.add(hit.id);
          nodes.push(hit);
        }
        setRows(nodes);
        setPhase('ready');
      });
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function join() {
    if (picked === '' || busy) return;
    setBusy(true);
    const result = await library.addMember(props.collectionId, picked, props.parentId);
    if (!result) {
      setBusy(false);
      return;
    }
    if (result.status === 'joined') await library.loadGraph(props.collectionId);
    setBusy(false);
    props.onDone(result.status, picked);
    props.onClose();
  }

  const parentName =
    props.parentId !== null && library.graphId === props.collectionId
      ? library.graph.nodes.find((node) => node.id === props.parentId)?.name
      : undefined;

  return createPortal(
    <div
      className="addm-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="addm-modal" role="dialog" aria-modal="true" aria-label="加入已有点">
        <div className="addm-head">
          <h2>加入已有点</h2>
          <button type="button" className="addm-close" aria-label="关闭" onClick={props.onClose}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="addm-body">
          <div className="addm-search">
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="7" cy="7" r="4.2" />
              <path d="m13 13-2.8-2.8" />
            </svg>
            <input
              value={query}
              autoFocus
              placeholder="点的名称"
              aria-label="搜索点的名称"
              onChange={(event) => {
                setQuery(event.target.value);
                setPicked('');
              }}
            />
          </div>
          {phase === 'error' ? (
            <p className="addm-note" role="alert">
              没有加载出来
            </p>
          ) : null}
          {phase === 'ready' && rows.length === 0 ? <p className="addm-note">没有找到</p> : null}
          {rows.length > 0 ? (
            <div className="addm-list">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={row.id === picked ? 'addm-pick on' : 'addm-pick'}
                  aria-pressed={row.id === picked}
                  onClick={() => setPicked(row.id)}
                >
                  <span className="addm-tick" aria-hidden>
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m3.5 8.5 3 3 6-7" />
                    </svg>
                  </span>
                  <span className="addm-main">
                    <span className="addm-name">{row.title}</span>
                    <span className="addm-meta">
                      {row.field === 'description' || row.field === 'content' ? row.snippet : row.snippet || '没有描述'}
                      {' · '}
                      {row.collectionTitle ?? '未归入合集'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <p className="addm-note">{SHARE_NOTE}</p>
          {library.error !== '' ? (
            <p className="addm-note" role="alert">
              {library.error}
            </p>
          ) : null}
        </div>
        <div className="addm-foot">
          <UButton onClick={props.onClose}>取消</UButton>
          <UButton
            variant="primary"
            className="addm-join"
            disabled={picked === '' || busy}
            onClick={() => void join()}
          >
            <span className="addm-join-label">{parentName ? `加入到「${parentName}」下` : '加入'}</span>
          </UButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
