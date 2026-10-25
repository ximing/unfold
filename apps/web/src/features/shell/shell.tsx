import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { IconPlus, IconSearch, IconSidebar, IconStarMap } from '../../shared/ui/icons/icons.js';
import { ToastHost } from '../../shared/ui/toast/toast.js';
import { CreateCollectionDialog } from '../collection/create-collection.js';
import { LibraryService } from '../library/library.service.js';
import { SessionService } from '../session/session.service.js';
import { MoreMenu } from './more-menu.js';
import { SearchPalette } from './search-palette.js';
import './shell.css';

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
