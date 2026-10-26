import { observer, useService } from '@rabjs/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { IconChevron, IconPlus, IconStarMap } from '../../shared/ui/icons/icons.js';
import { LibraryService } from '../library/library.service.js';
import { closeOtherPops, onPopClose } from './pop-bus.js';

export const CollectionSwitch = observer(function CollectionSwitch({ onCreate }: { onCreate: () => void }) {
  const library = useService(LibraryService);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const offPop = onPopClose(() => setOpen(false));
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      offPop();
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  const libraryOn = pathname === '/library' || pathname.startsWith('/library/');
  const collectionMatch = /^\/c\/([^/]+)/.exec(pathname);
  const current = collectionMatch
    ? library.collections.find((item) => item.id === collectionMatch[1])
    : undefined;
  const label = libraryOn ? '全貌图' : (current?.title ?? '合集');
  const count = libraryOn ? library.collections.length : current?.nodeCount;
  const unit = libraryOn ? '合集' : '点';

  return (
    <div className="pop-wrap" ref={rootRef}>
      <button
        type="button"
        className="switch-btn"
        title="切换合集"
        aria-label="切换合集"
        aria-expanded={open}
        onClick={() => {
          if (!open) closeOtherPops();
          setOpen((value) => !value);
        }}
      >
        <IconStarMap size={16} />
        <span className="switch-label">{label}</span>
        {count !== undefined ? (
          <span className="switch-cnt">
            {count} {unit}
          </span>
        ) : null}
        <IconChevron size={14} />
      </button>
      {open ? (
        <div className="dock-pop switch-pop">
          <button
            type="button"
            className={libraryOn ? 'on' : undefined}
            onClick={() => {
              setOpen(false);
              navigate('/library');
            }}
          >
            全貌图
          </button>
          {library.collections.length > 0 ? <div className="pop-sep" /> : null}
          {library.collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              className={collection.id === current?.id ? 'on' : undefined}
              onClick={() => {
                setOpen(false);
                navigate(`/c/${collection.id}`);
              }}
            >
              <span className="nm">{collection.title}</span>
              {collection.nodeCount > 0 ? <span className="cnt">{collection.nodeCount}</span> : null}
            </button>
          ))}
          <div className="pop-sep" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            <IconPlus size={14} />
            新建合集
            <span className="kbd">⌘N</span>
          </button>
        </div>
      ) : null}
    </div>
  );
});
