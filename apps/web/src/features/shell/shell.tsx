import { bindServices, observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router';
import { IconSearch } from '../../shared/ui/icons/icons.js';
import { ToastHost } from '../../shared/ui/toast/toast.js';
import { CreateCollectionDialog } from '../collection/create-collection.js';
import { LibraryService } from '../library/library.service.js';
import { SessionService } from '../session/session.service.js';
import { CollectionSwitch } from './collection-switch.js';
import { MoreMenu } from './more-menu.js';
import { SearchPalette } from './search-palette.js';
import { SettingsMenu } from './settings-menu.js';
import './shell.css';

const ShellView = observer(function ShellView() {
  const session = useService(SessionService);
  const library = useService(LibraryService);
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creating, setCreating] = useState(false);

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

  return (
    <div className="wk">
      <div className="stage-wrap">
        <Outlet />
      </div>
      <div className="dock">
        <MoreMenu />
        <CollectionSwitch
          onCreate={() => {
            library.clearError();
            setCreating(true);
          }}
        />
        <button
          type="button"
          className="dock-btn"
          title="搜索 ⌘K"
          aria-label="搜索"
          onClick={() => setPaletteOpen(true)}
        >
          <IconSearch />
        </button>
        <SettingsMenu />
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
