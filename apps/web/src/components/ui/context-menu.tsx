import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type UMenuItem = {
  label: string;
  hint?: string;
  danger?: boolean;
  onSelect: () => void;
};

export function UContextMenu(props: { x: number; y: number; items: UMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(props.x, window.innerWidth - rect.width - 8);
    const top = Math.min(props.y, window.innerHeight - rect.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [props.x, props.y]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      const el = ref.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      props.onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [props]);

  return (
    <div ref={ref} className="ctx-menu" style={pos} role="menu">
      {props.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'danger' : undefined}
          onClick={() => {
            props.onClose();
            item.onSelect();
          }}
        >
          {item.label}
          {item.hint ? <span className="hint">{item.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
