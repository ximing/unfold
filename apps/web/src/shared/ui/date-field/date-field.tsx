import { Calendar } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createHandoff } from '../../save/handoff.js';
import { noteDraft } from '../../save/save-bus.js';
import { takeServerText } from '../../save/server-text.js';
import { useSaveDraft } from '../../save/use-save-draft.js';
import './date-field.css';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 解析 YYYY-MM-DD / YYYY/M/D / YYYY.M.D / YYYY年M月D日；解析不了返回 null（保留原文） */
function parseDate(text: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(text.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function formatDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function IconCalendar() {
  return <Calendar size={15} strokeWidth={1.75} aria-hidden />;
}

/**
 * 日期字段：可以直接打字（自由文本也接受，比如「2024 春」），
 * 也可以点开日历选一天（提交 YYYY-MM-DD）。
 */
export function UDateField(props: {
  value: string;
  onCommit: (value: string) => void | Promise<boolean | void>;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(props.value);
  const savedRef = useRef(props.value);
  const hand = useRef(createHandoff()).current;
  draftRef.current = draft;

  const parsed = useMemo(() => parseDate(draft), [draft]);
  const today = useMemo(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }, []);
  const [view, setView] = useState(() => ({ y: (parsed ?? today).y, m: (parsed ?? today).m }));

  useEffect(() => {
    const decision = takeServerText(draftRef.current.trim(), savedRef.current, props.value, false);
    if (decision === 'keep') {
      noteDraft();
      return;
    }
    if (decision === 'echo') {
      savedRef.current = props.value;
      noteDraft();
      return;
    }
    savedRef.current = props.value;
    draftRef.current = props.value;
    setDraft(props.value);
    noteDraft();
  }, [props.value]);

  function commit(next = draftRef.current.trim()) {
    return hand.send(next, savedRef.current, () => props.onCommit(next));
  }

  useSaveDraft(
    () => hand.dirty(draftRef.current.trim(), savedRef.current),
    () => {
      void commit();
    },
  );

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  function openCalendar() {
    const base = parseDate(draft) ?? today;
    setView({ y: base.y, m: base.m });
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    setView((current) => {
      const next = current.m + delta;
      if (next < 1) return { y: current.y - 1, m: 12 };
      if (next > 12) return { y: current.y + 1, m: 1 };
      return { ...current, m: next };
    });
  }

  function pick(day: number) {
    const text = formatDate(view.y, view.m, day);
    draftRef.current = text;
    setDraft(text);
    void commit(text);
    setOpen(false);
  }

  // 周一开头的月历格子；0 表示上/下月补位（不渲染）
  const cells = useMemo(() => {
    const firstWeekday = (new Date(view.y, view.m - 1, 1).getDay() + 6) % 7;
    const total = daysInMonth(view.y, view.m);
    const grid: number[] = Array.from({ length: firstWeekday }, () => 0);
    for (let d = 1; d <= total; d += 1) grid.push(d);
    while (grid.length % 7 !== 0) grid.push(0);
    return grid;
  }, [view]);

  return (
    <div className="udate" ref={rootRef}>
      <input
        className="tf"
        aria-label={props.ariaLabel}
        placeholder={props.placeholder ?? 'YYYY-MM-DD'}
        value={draft}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
          hand.edit();
        }}
        onBlur={() => {
          void commit();
        }}
      />
      <button
        type="button"
        className="udate-cal"
        aria-label="打开日历"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openCalendar())}
      >
        <IconCalendar />
      </button>
      {open ? (
        <div className="udate-pop" role="dialog" aria-label="选择日期">
          <div className="udate-head">
            <button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <span>
              {view.y} 年 {view.m} 月
            </span>
            <button type="button" aria-label="下个月" onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="udate-grid">
            {WEEKDAYS.map((day) => (
              <span key={day} className="udate-wd">
                {day}
              </span>
            ))}
            {cells.map((day, index) =>
              day === 0 ? (
                <span key={index} />
              ) : (
                <button
                  key={index}
                  type="button"
                  className={[
                    'udate-day',
                    parsed && parsed.y === view.y && parsed.m === view.m && parsed.d === day ? 'on' : '',
                    today.y === view.y && today.m === view.m && today.d === day ? 'today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => pick(day)}
                >
                  {day}
                </button>
              ),
            )}
          </div>
          <div className="udate-foot">
            <button
              type="button"
              onClick={() => {
                const text = formatDate(today.y, today.m, today.d);
                setDraft(text);
                props.onCommit(text);
                setOpen(false);
              }}
            >
              今天
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
