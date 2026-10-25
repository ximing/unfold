import type { CardType } from '@unfold/dto';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { layoutBoard } from '../lib/board-layout.js';
import { cardMeta } from '../lib/card-meta.js';
import { GraphViewport } from './graph-viewport.js';

export type BoardCanvasItem = { id: string; label: string; description?: string; count?: number; types?: CardType[] };
export type BoardCanvasLink = { id: string; fromId: string; toId: string; label: string; count?: number };

type Pt = { x: number; y: number };

type Editing =
  | { kind: 'create'; at: Pt }
  | { kind: 'rename'; id: string }
  | { kind: 'link'; fromId: string; toId: string }
  | null;

function shortLabel(label: string): string {
  const chars = [...label];
  if (chars.length <= 12) return label;
  return `${chars.slice(0, 11).join('')}…`;
}

function shortDesc(text: string): string {
  const chars = [...text];
  if (chars.length <= 20) return text;
  return `${chars.slice(0, 19).join('')}…`;
}

function bounds(boxes: { x: number; y: number; w: number; h: number }[]) {
  if (boxes.length === 0) return { worldX: 0, worldY: 0, worldWidth: 520, worldHeight: 360 };
  const minX = Math.min(...boxes.map((box) => box.x)) - 48;
  const minY = Math.min(...boxes.map((box) => box.y)) - 48;
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + 96;
  const maxY = Math.max(...boxes.map((box) => box.y + box.h)) + 72;
  return {
    worldX: minX,
    worldY: minY,
    worldWidth: Math.max(520, maxX - minX),
    worldHeight: Math.max(360, maxY - minY),
  };
}

/** 图上的内联输入：创建、改名、写关系共用 */
function InlineInput(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  initial?: string;
  placeholder: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <foreignObject x={props.x} y={props.y} width={props.w} height={props.h} className="binput">
      <input
        ref={ref}
        defaultValue={props.initial ?? ''}
        placeholder={props.placeholder}
        maxLength={80}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            const text = event.currentTarget.value.trim();
            if (text === '') props.onCancel();
            else props.onCommit(text);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          }
        }}
        onBlur={(event) => {
          const text = event.currentTarget.value.trim();
          if (text === '') props.onCancel();
          else props.onCommit(text);
        }}
      />
    </foreignObject>
  );
}

export function BoardCanvas(props: {
  items: BoardCanvasItem[];
  links: BoardCanvasLink[];
  selectedId: string | null;
  onSelectItem: (id: string) => void;
  onSelectLink: (id: string) => void;
  /** 双击节点打开（合集）。与 onRenameItem 二选一 */
  onOpenItem?: (id: string) => void;
  /** 双击节点内联改名 */
  onRenameItem?: (id: string, name: string) => void;
  /** 双击空白内联创建；placeholder 也是开关 */
  createPlaceholder?: string;
  onCreate?: (name: string) => void;
  /** 从节点手柄拖到另一个节点连线 */
  onConnect?: (fromId: string, toId: string, label: string) => void;
  /** 悬停预览内容 */
  renderPeek?: (id: string) => ReactNode;
  onPeekItem?: (id: string | null) => void;
  /** Esc（方向键导航后取消选中） */
  onEscape?: () => void;
}) {
  const boxes = layoutBoard(props.items, props.links);
  const boxOf = new Map(boxes.map((box) => [box.id, box]));
  const world = bounds(boxes);
  const resetKey = `${props.items.map((item) => item.id).join(',')}|${props.links.map((link) => link.id).join(',')}`;

  const worldRef = useRef<SVGGElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [linkFrom, setLinkFrom] = useState<{ id: string; cursor: Pt } | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekTimer = useRef(0);

  function toWorld(clientX: number, clientY: number): Pt {
    const g = worldRef.current;
    const m = g?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  /* ---------- 悬停预览 ---------- */
  function armPeek(id: string) {
    if (!props.renderPeek) return;
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => {
      setPeekId(id);
      props.onPeekItem?.(id);
    }, 450);
  }

  function disarmPeek() {
    window.clearTimeout(peekTimer.current);
    if (peekId !== null) {
      setPeekId(null);
      props.onPeekItem?.(null);
    }
  }

  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  /* ---------- 键盘导航：方向键移动选中，Enter 打开/改名，Esc 取消 ---------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('.modal-wrap, .overlay, .ctx-menu')) return;
      if (editing || linkFrom) return;

      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const dir = dirs[event.key];
      if (dir) {
        if (boxes.length === 0) return;
        event.preventDefault();
        disarmPeek();
        const current = props.selectedId ? boxOf.get(props.selectedId) : undefined;
        if (!current) {
          const first = props.items[0];
          if (first) props.onSelectItem(first.id);
          return;
        }
        const cx = current.x + current.w / 2;
        const cy = current.y + current.h / 2;
        let best: { id: string; score: number } | null = null;
        for (const box of boxes) {
          if (box.id === current.id) continue;
          const ox = box.x + box.w / 2 - cx;
          const oy = box.y + box.h / 2 - cy;
          const primary = dir[0] !== 0 ? ox * dir[0] : oy * dir[1];
          if (primary <= 4) continue;
          const cross = dir[0] !== 0 ? Math.abs(oy) : Math.abs(ox);
          const score = primary + cross * 2.5;
          if (!best || score < best.score) best = { id: box.id, score };
        }
        if (best) props.onSelectItem(best.id);
        return;
      }
      if (event.key === 'Enter') {
        const item = props.items.find((entry) => entry.id === props.selectedId);
        if (!item) return;
        event.preventDefault();
        disarmPeek();
        if (props.onOpenItem) props.onOpenItem(item.id);
        else if (props.onRenameItem) setEditing({ kind: 'rename', id: item.id });
        return;
      }
      if (event.key === 'Escape') props.onEscape?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------- 拖拽连线 ---------- */
  function beginLink(event: ReactPointerEvent, fromId: string) {
    if (!props.onConnect) return;
    event.stopPropagation();
    event.preventDefault();
    disarmPeek();
    setLinkFrom({ id: fromId, cursor: toWorld(event.clientX, event.clientY) });
  }

  useEffect(() => {
    if (!linkFrom) return;
    const onMove = (event: PointerEvent) => {
      setLinkFrom((current) => (current ? { ...current, cursor: toWorld(event.clientX, event.clientY) } : null));
    };
    const onUp = (event: PointerEvent) => {
      setLinkFrom((current) => {
        if (!current) return null;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]');
        const toId = target?.getAttribute('data-node-id') ?? '';
        if (toId !== '' && toId !== current.id) {
          setEditing({ kind: 'link', fromId: current.id, toId });
        }
        return null;
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinkFrom(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [linkFrom !== null]);

  const peekBox = peekId ? boxOf.get(peekId) : undefined;
  const peekWidth = 240;
  const peekFlip = peekBox ? peekBox.x + peekBox.w + 12 + peekWidth > world.worldX + world.worldWidth : false;

  return (
    <GraphViewport
      worldX={world.worldX}
      worldY={world.worldY}
      worldWidth={world.worldWidth}
      worldHeight={world.worldHeight}
      resetKey={resetKey}
      onBackgroundDoubleClick={
        props.onCreate && props.createPlaceholder
          ? (point) => {
              disarmPeek();
              setEditing({ kind: 'create', at: { x: point.worldX, y: point.worldY } });
            }
          : undefined
      }
      minimap={
        <>
          {boxes.map((box) => (
            <rect
              key={box.id}
              className={props.selectedId === box.id ? 'mm-node focus' : 'mm-node'}
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={6}
            />
          ))}
        </>
      }
    >
      <g ref={worldRef}>
        <defs>
          <pattern id="board-dots" width={26} height={26} patternUnits="userSpaceOnUse">
            <circle cx={1.2} cy={1.2} r={1.2} fill="rgba(0, 0, 0, 0.09)" />
          </pattern>
          <marker id="board-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="rgba(0, 0, 0, 0.3)" />
          </marker>
          <marker id="board-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
          </marker>
        </defs>
        <rect
          x={world.worldX - 600}
          y={world.worldY - 600}
          width={world.worldWidth + 1200}
          height={world.worldHeight + 1200}
          fill="url(#board-dots)"
          pointerEvents="none"
        />

        {props.links.map((link) => {
          const from = boxOf.get(link.fromId);
          const to = boxOf.get(link.toId);
          if (!from || !to) return null;
          const x1 = from.x + from.w;
          const y1 = from.y + from.h / 2;
          const x2 = to.x;
          const y2 = to.y + to.h / 2;
          const selected = props.selectedId === link.id;
          return (
            <g
              key={link.id}
              className={selected ? 'node bedge-g on' : 'node bedge-g'}
              role="button"
              aria-label={link.label}
              onClick={() => {
                disarmPeek();
                props.onSelectLink(link.id);
              }}
            >
              <line className="bedge-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
              <line
                className="bedge"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                markerEnd={selected ? 'url(#board-arrow-on)' : 'url(#board-arrow)'}
              />
              <text className="bedge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 9} textAnchor="middle">
                {shortLabel(link.label)}
                {(link.count ?? 0) > 0 ? <tspan className="cnt" dx={5}>·{link.count}</tspan> : null}
              </text>
            </g>
          );
        })}

        {props.items.map((item) => {
          const box = boxOf.get(item.id);
          if (!box) return null;
          const selected = props.selectedId === item.id;
          const types = (item.types ?? []).slice(0, 6);
          const desc = (item.description ?? '').trim();
          const cy = box.y + box.h / 2;
          const nameY = desc !== '' ? box.y + 19 : types.length > 0 ? cy - 4 : cy;
          const dotsY = desc !== '' ? box.y + box.h - 6 : box.y + box.h - 7;
          const renaming = editing?.kind === 'rename' && editing.id === item.id;
          return (
            <g
              key={item.id}
              className={selected ? 'node bnode on' : 'node bnode'}
              data-node-id={item.id}
              role="button"
              aria-label={item.label}
              onClick={() => {
                disarmPeek();
                props.onSelectItem(item.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                disarmPeek();
                if (props.onOpenItem) props.onOpenItem(item.id);
                else if (props.onRenameItem) setEditing({ kind: 'rename', id: item.id });
              }}
              onPointerEnter={() => armPeek(item.id)}
              onPointerLeave={disarmPeek}
              onPointerDown={disarmPeek}
            >
              <rect className="bnode-rect" x={box.x} y={box.y} width={box.w} height={box.h} rx={11} />
              {!renaming ? (
                <text className="bnode-name" x={box.x + box.w / 2} y={nameY} textAnchor="middle">
                  {shortLabel(item.label)}
                </text>
              ) : null}
              {desc !== '' && !renaming ? (
                <text className="bnode-desc" x={box.x + box.w / 2} y={box.y + 37} textAnchor="middle">
                  {shortDesc(desc)}
                </text>
              ) : null}
              {types.length > 0
                ? types.map((type, index) => (
                    <circle
                      key={type}
                      className="bnode-dot"
                      cx={box.x + box.w / 2 + (index - (types.length - 1) / 2) * 9}
                      cy={dotsY}
                      r={2.4}
                      fill={cardMeta(type).hue}
                    />
                  ))
                : null}
              {(item.count ?? 0) > 0
                ? (() => {
                    const bw = 12 + String(item.count).length * 6;
                    const cx = box.x + box.w - 4;
                    return (
                      <g className="bnode-badge" pointerEvents="none">
                        <rect x={cx - bw / 2} y={box.y - 7} width={bw} height={14} rx={7} />
                        <text x={cx} y={box.y} textAnchor="middle">
                          {item.count}
                        </text>
                      </g>
                    );
                  })()
                : null}
              {props.onConnect ? (
                <circle
                  className="bnode-handle"
                  cx={box.x + box.w}
                  cy={cy}
                  r={5}
                  onPointerDown={(event) => beginLink(event, item.id)}
                />
              ) : null}
              <title>{item.label}</title>
            </g>
          );
        })}

        {/* 拖拽中的临时连线 */}
        {linkFrom
          ? (() => {
              const from = boxOf.get(linkFrom.id);
              if (!from) return null;
              return (
                <g pointerEvents="none">
                  <line
                    className="blink-temp"
                    x1={from.x + from.w}
                    y1={from.y + from.h / 2}
                    x2={linkFrom.cursor.x}
                    y2={linkFrom.cursor.y}
                  />
                  <circle className="blink-temp-dot" cx={linkFrom.cursor.x} cy={linkFrom.cursor.y} r={3.5} />
                </g>
              );
            })()
          : null}

        {/* 悬停预览 */}
        {peekBox && props.renderPeek ? (
          <foreignObject
            className="bpeek"
            x={peekFlip ? peekBox.x - 12 - peekWidth : peekBox.x + peekBox.w + 12}
            y={peekBox.y + peekBox.h / 2 - 56}
            width={peekWidth}
            height={140}
          >
            {props.renderPeek(peekBox.id)}
          </foreignObject>
        ) : null}

        {/* 内联输入 */}
        {editing?.kind === 'create' ? (
          <InlineInput
            x={editing.at.x - 84}
            y={editing.at.y - 17}
            w={168}
            h={34}
            placeholder={props.createPlaceholder ?? ''}
            onCommit={(name) => {
              setEditing(null);
              props.onCreate?.(name);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {editing?.kind === 'rename'
          ? (() => {
              const box = boxOf.get(editing.id);
              const item = props.items.find((entry) => entry.id === editing.id);
              if (!box || !item) return null;
              return (
                <InlineInput
                  x={box.x - 2}
                  y={box.y + box.h / 2 - 17}
                  w={box.w + 4}
                  h={34}
                  initial={item.label}
                  placeholder={item.label}
                  onCommit={(name) => {
                    setEditing(null);
                    if (name !== item.label) props.onRenameItem?.(item.id, name);
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            })()
          : null}
        {editing?.kind === 'link'
          ? (() => {
              const from = boxOf.get(editing.fromId);
              const to = boxOf.get(editing.toId);
              if (!from || !to) return null;
              const mx = (from.x + from.w + to.x) / 2;
              const my = (from.y + to.y + to.h) / 2;
              return (
                <InlineInput
                  x={mx - 84}
                  y={my - 17}
                  w={168}
                  h={34}
                  placeholder="关系，例如：前提"
                  onCommit={(label) => {
                    const draft = editing;
                    setEditing(null);
                    props.onConnect?.(draft.fromId, draft.toId, label);
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            })()
          : null}
      </g>
    </GraphViewport>
  );
}
