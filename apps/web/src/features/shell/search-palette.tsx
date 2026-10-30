import { observer, useService } from '@rabjs/react';
import type { SearchHit } from '@unfold/dto';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { IconSearch } from '../../shared/ui/icons/icons.js';
import { USegmented } from '../../shared/ui/segmented/segmented.js';
import { LibraryService } from '../library/library.service.js';
import './palette.css';

const SEARCH_KEY = 'unfold.search-return.v1';

type SearchScope = 'account' | 'collection';

type SearchMemory = {
  query: string;
  scope: SearchScope;
  scrollTop: number;
};

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  collection: '合集',
  node: '点',
  edge: '边',
  collection_edge: '合集边',
  card: '卡片',
};

const KIND_ORDER: SearchHit['kind'][] = ['node', 'collection', 'edge', 'collection_edge', 'card'];

const FIELD_LABEL: Record<SearchHit['field'], string> = {
  title: '标题',
  name: '名称',
  description: '描述',
  label: '关系',
  content: '正文',
};

function readMemory(): SearchMemory {
  try {
    const raw = sessionStorage.getItem(SEARCH_KEY);
    if (!raw) return { query: '', scope: 'account', scrollTop: 0 };
    const data = JSON.parse(raw) as Partial<SearchMemory>;
    return {
      query: typeof data.query === 'string' ? data.query : '',
      scope: data.scope === 'collection' ? 'collection' : 'account',
      scrollTop: typeof data.scrollTop === 'number' && data.scrollTop >= 0 ? data.scrollTop : 0,
    };
  } catch {
    return { query: '', scope: 'account', scrollTop: 0 };
  }
}

function writeMemory(memory: SearchMemory): void {
  try {
    sessionStorage.setItem(SEARCH_KEY, JSON.stringify(memory));
  } catch {
    // 存不了时这次关闭就忘掉滚动
  }
}

function collectionIdFromPath(pathname: string): string | null {
  const match = /^\/c\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

function hitPath(hit: SearchHit): string | null {
  const card = hit.cardId ?? (hit.kind === 'card' ? hit.id : null);
  if (hit.kind === 'collection') return `/c/${hit.id}`;
  if (hit.kind === 'collection_edge') {
    const edgeId = hit.edgeId ?? hit.id;
    return card ? `/library?collectionEdge=${edgeId}&card=${card}` : `/library?collectionEdge=${edgeId}`;
  }
  if (hit.kind === 'edge' || (hit.kind === 'card' && hit.ownerKind === 'edge')) {
    const edgeId = hit.kind === 'edge' ? hit.id : hit.edgeId;
    if (!edgeId) return null;
    if (hit.collectionId) {
      return card ? `/c/${hit.collectionId}?edge=${edgeId}&card=${card}` : `/c/${hit.collectionId}?edge=${edgeId}`;
    }
    return card ? `/library?link=${edgeId}&card=${card}` : `/library?link=${edgeId}`;
  }
  if (hit.kind === 'card' && hit.ownerKind === 'collection_edge') {
    const edgeId = hit.edgeId;
    if (!edgeId) return null;
    return card ? `/library?collectionEdge=${edgeId}&card=${card}` : `/library?collectionEdge=${edgeId}`;
  }
  const nodeId = hit.kind === 'node' ? hit.id : hit.nodeId;
  if (!nodeId) return null;
  if (hit.collectionId) {
    return card ? `/c/${hit.collectionId}?node=${nodeId}&card=${card}` : `/c/${hit.collectionId}?node=${nodeId}`;
  }
  return card ? `/library?node=${nodeId}&card=${card}` : `/library?node=${nodeId}`;
}

/** 大小写不敏感地把 query 子串包成 <mark>，其余保持纯文本节点 */
function markQuery(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (needle === '' || text === '') return text;
  const haystack = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let markIndex = 0;
  while (cursor < text.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;
    if (found > cursor) parts.push(text.slice(cursor, found));
    parts.push(<mark key={markIndex}>{text.slice(found, found + needle.length)}</mark>);
    markIndex += 1;
    cursor = found + needle.length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

/** 按固定组序重排，组内保留服务端返回的优先级顺序；高亮索引落在这份展示顺序上 */
function orderHits(hits: SearchHit[]): { kind: SearchHit['kind']; items: { hit: SearchHit; index: number }[] }[] {
  let index = 0;
  const groups = [];
  for (const kind of KIND_ORDER) {
    const items = [];
    for (const hit of hits) {
      if (hit.kind !== kind) continue;
      items.push({ hit, index });
      index += 1;
    }
    if (items.length > 0) groups.push({ kind, items });
  }
  return groups;
}

export const SearchPalette = observer(function SearchPalette({ onClose }: { onClose: () => void }) {
  const library = useService(LibraryService);
  const navigate = useNavigate();
  const location = useLocation();
  const pageCollectionId = collectionIdFromPath(location.pathname);
  const inputRef = useRef<HTMLInputElement>(null);
  const hitsRef = useRef<HTMLDivElement>(null);
  const memory = useRef(readMemory());
  const scrollTop = useRef(memory.current.scrollTop);
  const [query, setQuery] = useState(memory.current.query);
  const [scope, setScope] = useState<SearchScope>(memory.current.scope);
  const [highlight, setHighlight] = useState(0);
  const effective: SearchScope = scope === 'collection' && pageCollectionId ? 'collection' : 'account';

  useEffect(() => {
    inputRef.current?.focus();
    const box = hitsRef.current;
    if (box && scrollTop.current > 0) box.scrollTop = scrollTop.current;
  }, []);

  useEffect(() => {
    writeMemory({ query, scope, scrollTop: scrollTop.current });
  }, [query, scope]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      library.clearSearch();
      return;
    }
    const timer = window.setTimeout(() => {
      void library.search({
        query: trimmed,
        scope: effective,
        collectionId: effective === 'collection' ? (pageCollectionId ?? undefined) : undefined,
        preferCollectionId: pageCollectionId ?? undefined,
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [effective, library, pageCollectionId, query]);

  const hits = query.trim() === '' ? [] : library.searchHits;
  const groups = orderHits(hits);
  const total = hits.length;

  const restoredScroll = useRef(false);

  useEffect(() => {
    setHighlight(0);
  }, [query, effective]);

  useEffect(() => {
    const box = hitsRef.current;
    if (!box || restoredScroll.current || scrollTop.current <= 0 || total === 0) return;
    box.scrollTop = scrollTop.current;
    restoredScroll.current = true;
  }, [total]);

  function openHit(index: number) {
    const entry = groups.flatMap((group) => group.items)[index];
    if (!entry) return;
    const path = hitPath(entry.hit);
    if (!path) return;
    navigate(path);
    onClose();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (total === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => (current + delta + total) % total);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openHit(highlight);
    }
  }

  function loadMore() {
    const cursor = library.searchCursor;
    if (!cursor || query.trim() === '') return;
    void library.search({
      query,
      scope: effective,
      collectionId: effective === 'collection' ? (pageCollectionId ?? undefined) : undefined,
      preferCollectionId: pageCollectionId ?? undefined,
      cursor,
    });
  }

  const showEmpty = query.trim() !== '' && !library.searchLoading && library.searchError === '' && total === 0;

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="搜索">
        <div className="pin">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            placeholder="搜索"
            aria-label="搜索"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="palette-scope">
          <USegmented
            ariaLabel="搜索范围"
            value={effective}
            options={[
              { value: 'account', label: '全部' },
              { value: 'collection', label: '当前合集', disabled: pageCollectionId === null },
            ]}
            onChange={(value) => setScope(value === 'collection' ? 'collection' : 'account')}
          />
        </div>
        <div
          className="hits"
          ref={hitsRef}
          onScroll={(event) => {
            scrollTop.current = event.currentTarget.scrollTop;
            writeMemory({ query, scope, scrollTop: scrollTop.current });
          }}
        >
          {library.searchError !== '' ? (
            <p className="empty-line" role="alert">
              没有加载出来
            </p>
          ) : null}
          {showEmpty ? <p className="empty-line">没有找到</p> : null}
          {groups.map((group) => (
            <Fragment key={group.kind}>
              <p className="hit-group">{KIND_LABEL[group.kind]}</p>
              {group.items.map(({ hit, index }) => (
                <button
                  key={`${hit.kind}:${hit.id}:${hit.field}:${index}`}
                  type="button"
                  className={index === highlight ? 'hit hl' : 'hit'}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => openHit(index)}
                >
                  <span className="hit-title">
                    {markQuery(hit.title, query)}
                    <span className="hit-kind">{FIELD_LABEL[hit.field]}</span>
                  </span>
                  <span className="hit-meta">
                    {hit.collectionTitle ?? '未归入合集'}
                    {hit.snippet !== '' ? <> · {markQuery(hit.snippet, query)}</> : null}
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
          {library.searchError === '' && library.searchCursor ? (
            <button type="button" className="more-hits" onClick={loadMore} disabled={library.searchLoading}>
              加载更多
            </button>
          ) : null}
        </div>
        <div className="foot">
          <span>
            <kbd>↑↓</kbd> 选择
          </span>
          <span>
            <kbd>⏎</kbd> 打开
          </span>
          <span>
            <kbd>esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  );
});
