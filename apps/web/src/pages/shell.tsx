import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { CreateCollectionDialog } from '../components/create-collection.js';
import { IconMore, IconPlus, IconSearch, IconSidebar, IconStarMap } from '../components/ui/icons.js';
import { ToastHost } from '../components/ui/toast.js';
import { LibraryService } from '../services/library.service.js';
import { SessionService } from '../services/session.service.js';

const SearchPalette = observer(function SearchPalette({ onClose }: { onClose: () => void }) {
  const library = useService(LibraryService);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      library.clearSearch();
      return;
    }
    const timer = window.setTimeout(() => {
      void library.search(trimmed);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [library, query]);

  const hits = query.trim() === '' ? [] : library.searchHits;

  useEffect(() => {
    setHighlight(0);
  }, [query, hits.length]);

  function openHit(index: number) {
    const hit = hits[index];
    if (!hit || hit.collectionId === '') return;
    navigate(`/c/${hit.collectionId}?node=${hit.nodeId}`);
    onClose();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => (current + delta + hits.length) % hits.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openHit(highlight);
    }
  }

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
            placeholder="搜索点或卡片"
            aria-label="搜索"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="hits">
          {library.error !== '' ? <p className="empty-line">{library.error}</p> : null}
          {query.trim() !== '' && hits.length === 0 && library.error === '' ? (
            <p className="empty-line">没有这条记录</p>
          ) : null}
          {hits.map((hit, index) => (
            <button
              key={`${hit.nodeId}:${hit.collectionId}:${index}`}
              type="button"
              className={index === highlight ? 'hit hl' : 'hit'}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => openHit(index)}
            >
              <span>{hit.name}</span>
              {hit.collectionId === '' ? (
                <small>不在任何合集</small>
              ) : hit.snippet !== '' ? (
                <small>{hit.snippet}</small>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

const MoreMenu = observer(function MoreMenu() {
  const session = useService(SessionService);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  return (
    <div className="rail-pop-wrap" ref={rootRef}>
      <button
        type="button"
        className="rail-btn"
        title="更多"
        aria-label="更多"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconMore />
      </button>
      {open ? (
        <div className="rail-pop">
          <button
            type="button"
            className="danger"
            onClick={() => {
              void session.logout().then((ok) => {
                if (ok) navigate('/login');
              });
            }}
          >
            登出
          </button>
        </div>
      ) : null}
    </div>
  );
});

const ShellView = observer(function ShellView() {
  const session = useService(SessionService);
  const library = useService(LibraryService);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sideOff, setSideOff] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!session.username) await session.restore();
      if (session.username) await library.loadCollections();
    })();
  }, [library, session]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        library.clearError();
        setCreating(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [library]);

  if (session.ready && !session.username) return <Navigate to="/login" replace />;

  const libraryOn = pathname === '/library' || pathname.startsWith('/library/');

  return (
    <div className={sideOff ? 'wk side-off' : 'wk'}>
      <div className="rail">
        <Link className="logo" to="/library" aria-label="Unfold">
          展
        </Link>
        <Link className={libraryOn ? 'rail-btn on' : 'rail-btn'} to="/library" title="合集" aria-label="合集">
          <IconStarMap />
        </Link>
        <button type="button" className="rail-btn" title="搜索 ⌘K" aria-label="搜索" onClick={() => setPaletteOpen(true)}>
          <IconSearch />
        </button>
        <button
          type="button"
          className="rail-btn"
          title="新建合集 ⌘N"
          aria-label="新建合集"
          onClick={() => {
            library.clearError();
            setCreating(true);
          }}
        >
          <IconPlus />
        </button>
        <button
          type="button"
          className="rail-btn"
          title={sideOff ? '显示目录' : '收起目录'}
          aria-label={sideOff ? '显示目录' : '收起目录'}
          onClick={() => setSideOff((value) => !value)}
        >
          <IconSidebar />
        </button>
        <div className="sp" />
        <MoreMenu />
      </div>
      <nav className="side" aria-label="合集">
        <div className="side-head">
          <p className="side-h">合集</p>
        </div>
        {library.collections.map((collection) => (
          <NavLink
            key={collection.id}
            className={({ isActive }) => `item${isActive ? ' on' : ''}`}
            end
            to={`/c/${collection.id}`}
          >
            <span className="nm">{collection.title}</span>
            {collection.nodeCount > 0 ? <span className="cnt">{collection.nodeCount}</span> : null}
          </NavLink>
        ))}
        {library.collections.length === 0 ? <p className="item minor">还没有合集</p> : null}
      </nav>
      <div className="stage-wrap">
        <Outlet />
      </div>
      {paletteOpen ? <SearchPalette onClose={() => setPaletteOpen(false)} /> : null}
      {creating ? (
        <CreateCollectionDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/c/${id}`)}
        />
      ) : null}
      <ToastHost />
    </div>
  );
});

export const Shell = bindServices(ShellView, [LibraryService]);
