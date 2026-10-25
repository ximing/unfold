import { observer, useService } from '@rabjs/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconMore } from '../../shared/ui/icons/icons.js';
import { SessionService } from '../session/session.service.js';

export const MoreMenu = observer(function MoreMenu() {
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
