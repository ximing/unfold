import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevron } from '../icons/icons.js';
import './select.css';

export type USelectOption = { value: string; label: string; icon?: ReactNode };

export function USelect(props: {
  value: string;
  options: USelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  /** 悬停名称。打开时不显示，避免挡住列表。 */
  tip?: string;
  tabIndex?: number;
  /** 按下时不把焦点带走，编辑器里的选区才留得住。 */
  holdFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const current = props.options.find((option) => option.value === props.value);

  function openList() {
    setHighlight(Math.max(0, props.options.findIndex((option) => option.value === props.value)));
    setOpen(true);
  }

  function choose(value: string) {
    props.onChange(value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => (current + delta + props.options.length) % props.options.length);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = props.options[highlight];
      if (option) choose(option.value);
    }
  }

  return (
    <div className="usel" ref={rootRef}>
      <button
        type="button"
        className={open ? 'usel-btn open' : 'usel-btn'}
        aria-label={props.ariaLabel}
        aria-expanded={open}
        data-tip={open ? undefined : props.tip}
        tabIndex={props.tabIndex}
        onMouseDown={(event) => {
          if (!props.holdFocus) return;
          // 拦住按下会吃掉随后的 click，所以在按下时就打开。
          event.preventDefault();
          if (open) setOpen(false);
          else openList();
        }}
        onClick={() => {
          if (props.holdFocus) return;
          if (open) setOpen(false);
          else openList();
        }}
        onKeyDown={onKeyDown}
      >
        {current?.icon ? (
          <span className="usel-icon">{current.icon}</span>
        ) : current ? (
          current.label
        ) : (
          <span className="ph">{props.placeholder ?? '请选择'}</span>
        )}
        <IconChevron />
      </button>
      {open ? (
        <div className="usel-pop" role="listbox">
          {props.options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-label={option.label}
              aria-selected={option.value === props.value}
              className={option.icon ? (index === highlight ? 'opt has-icon hl' : 'opt has-icon') : index === highlight ? 'opt hl' : 'opt'}
              onMouseDown={(event) => {
                if (!props.holdFocus) return;
                event.preventDefault();
                choose(option.value);
              }}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => {
                if (props.holdFocus) return;
                choose(option.value);
              }}
            >
              {option.icon ? <span className="usel-icon">{option.icon}</span> : option.label}
              {option.value === props.value ? <span className="tick">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
