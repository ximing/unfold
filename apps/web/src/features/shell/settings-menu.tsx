import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconGear, IconStarMap } from '../../shared/ui/icons/icons.js';
import { closeOtherPops, onPopClose } from './pop-bus.js';

export function SettingsMenu() {
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

  return (
    <div className="pop-wrap" ref={rootRef}>
      <button
        type="button"
        className="dock-btn"
        title="设置"
        aria-label="设置"
        aria-expanded={open}
        onClick={() => {
          if (!open) closeOtherPops();
          setOpen((value) => !value);
        }}
      >
        <IconGear />
      </button>
      {open ? (
        <div className="dock-pop settings-pop">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/library');
            }}
          >
            <IconStarMap size={14} />
            回到全貌图
          </button>
        </div>
      ) : null}
    </div>
  );
}
