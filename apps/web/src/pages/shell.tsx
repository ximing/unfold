import { bindServices, observer, useService } from '@rabjs/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { LibraryService } from '../services/library.service.js';
import { SessionService } from '../services/session.service.js';

function kindLabel(kind: 'object' | 'block' | 'question' | 'decision' | 'collection_sentence'): string {
  switch (kind) {
    case 'object':
      return '点';
    case 'block':
      return '块';
    case 'question':
      return '疑问';
    case 'decision':
      return '决定';
    case 'collection_sentence':
      return '合集里的句子';
  }
}

const SearchBox = observer(function SearchBox() {
  const library = useService(LibraryService);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') return;
    const timer = window.setTimeout(() => {
      void library.search(trimmed);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [library, query]);

  const trimmed = query.trim();

  return (
    <div className="search" ref={rootRef}>
      <input
        id="q"
        ref={inputRef}
        type="search"
        placeholder="搜索点、疑问或决定　⌘K"
        aria-label="搜索"
        autoComplete="off"
        aria-controls="hits"
        aria-expanded={open}
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (next.trim() === '') {
            library.clearSearch();
            setOpen(false);
            return;
          }
          setOpen(true);
        }}
      />
      <div id="hits" className="hits" hidden={!open || trimmed === ''}>
        {library.searchQuery === trimmed ? (
          <>
            {library.searchNotice === '检索降级中' ? <p className="muted">检索降级中</p> : null}
            {library.searchError !== '' ? <p role="alert">{library.searchError}</p> : null}
            {library.searchGroups.length === 0 && library.searchError === '' ? (
              <p className="muted">没有这条记录</p>
            ) : null}
            {library.searchGroups.map((group, groupIndex) => {
              const objectId = group.objectId;
              const title = group.domain !== '' ? `${group.title} · ${group.domain}` : group.title;
              return (
                <div key={`${objectId ?? ''}:${group.domain}:${groupIndex}`}>
                  <p className="group">{title}</p>
                  {group.hits.map((hit, hitIndex) => {
                    const secondary =
                      hit.text !== '' ? hit.text : hit.kind === 'object' && group.core !== '' ? group.core : '';
                    return (
                      <button
                        key={`${hit.id}:${hitIndex}`}
                        type="button"
                        disabled={objectId === null || objectId === ''}
                        onClick={() => {
                          if (objectId === null || objectId === '') return;
                          navigate('/o/' + objectId);
                          setOpen(false);
                        }}
                      >
                        {kindLabel(hit.kind)}
                        {hit.promote === true ? ' · 可提升' : null}
                        {secondary !== '' ? <small>{secondary}</small> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : trimmed !== '' ? (
          <p className="muted">正在检索…</p>
        ) : null}
      </div>
    </div>
  );
});

function CollectionLinks({
  items,
  parentId,
  depth,
}: {
  items: LibraryService['collections'];
  parentId: string | null;
  depth: number;
}) {
  const nodes = items.filter((item) => item.parentCollectionId === parentId);
  return (
    <>
      {nodes.map((item) => (
        <Fragment key={item.id}>
          <NavLink
            to={'/c/' + item.id}
            style={depth > 0 ? { paddingLeft: `${depth * 0.75}rem` } : undefined}
          >
            合集 · {item.title}
          </NavLink>
          <CollectionLinks items={items} parentId={item.id} depth={depth + 1} />
        </Fragment>
      ))}
    </>
  );
}

const ShellView = observer(function ShellView() {
  const session = useService(SessionService);
  const library = useService(LibraryService);

  useEffect(() => {
    void (async () => {
      if (!session.username) await session.restore();
      if (session.username) {
        await library.loadDomains();
        if (library.error === '领域没有加载出来') return;
        for (const domain of library.domains) {
          await library.loadCollections(domain.id);
        }
      }
    })();
  }, [library, session]);

  if (session.ready && !session.username) return <Navigate to="/login" replace />;

  return (
    <div className="frame">
      <aside className="rail">
        <NavLink to="/today">今日</NavLink>
        {library.domains.map((domain) => (
          <div key={domain.id} className="rail-domain">
            <p>{domain.name}</p>
            {library.collections.some((item) => item.domainId === domain.id) ? (
              <CollectionLinks
                items={library.collections.filter((item) => item.domainId === domain.id)}
                parentId={null}
                depth={0}
              />
            ) : (
              <p className="muted">还没有合集</p>
            )}
            <NavLink to={`/free/${domain.id}`}>游离 · {domain.freeCount} 个点</NavLink>
          </div>
        ))}
        <NavLink to="/new">新建点</NavLink>
        {library.error === '领域没有加载出来' ? <p role="alert">{library.error}</p> : null}
      </aside>
      <div className="work">
        <SearchBox />
        <Outlet />
      </div>
    </div>
  );
});

export const Shell = bindServices(ShellView, [LibraryService]);
