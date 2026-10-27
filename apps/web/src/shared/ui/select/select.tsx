import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevron } from '../icons/icons.js';
import { filterSelectOptions } from './select-filter.js';
import './select.css';

export type USelectOption = { value: string; label: string; icon?: ReactNode; keywords?: string };

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
  /** 打开后可以输入，按名称、值和 keywords 过滤。 */
  searchable?: boolean;
  searchLabel?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = props.searchable ? filterSelectOptions(props.options, query) : props.options;
  const activeIndex = visible.length === 0 ? 0 : Math.min(highlight, visible.length - 1);

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

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[activeIndex];
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, query]);

  const current = props.options.find((option) => option.value === props.value);

  function openList() {
    setQuery('');
    setHighlight(Math.max(0, props.options.findIndex((option) => option.value === props.value)));
    setOpen(true);
  }

  function choose(value: string) {
    props.onChange(value);
    setOpen(false);
  }

  function moveHighlight(delta: number) {
    if (visible.length === 0) return;
    setHighlight((currentIndex) => {
      const base = Math.min(currentIndex, visible.length - 1);
      return (base + delta + visible.length) % visible.length;
    });
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
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || (event.key === ' ' && !props.searchable)) {
      event.preventDefault();
      const option = visible[activeIndex];
      if (option) choose(option.value);
    }
  }

  function optionClass(icon: boolean, on: boolean): string {
    const names = ['opt'];
    if (icon) names.push('has-icon');
    if (on) names.push('hl');
    return names.join(' ');
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
        <div className="usel-pop">
          {props.searchable ? (
            <input
              className="usel-search"
              type="text"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={props.searchLabel ?? '搜索'}
              aria-label={props.searchLabel ?? '搜索'}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                onKeyDown(event);
              }}
            />
          ) : null}
          <div className="usel-list" role="listbox" ref={listRef}>
            {visible.length === 0 ? (
              <div className="usel-empty">没有匹配</div>
            ) : (
              visible.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-label={option.label}
                  aria-selected={option.value === props.value}
                  className={optionClass(Boolean(option.icon), index === activeIndex)}
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
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
