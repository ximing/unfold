import type { PointerEvent as ReactPointerEvent } from 'react';
import { cardMeta } from '../cards/card-meta.js';
import type { BoardCanvasItem } from './board-canvas.js';
import type { BoardBox } from './board-layout.js';
import { shortDesc, shortLabel } from './label.js';

export function BoardNodes(props: {
  items: BoardCanvasItem[];
  boxOf: Map<string, BoardBox>;
  selectedId: string | null;
  renamingId: string | null;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  onPointerEnter: (id: string) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onBeginLink?: (event: ReactPointerEvent, id: string) => void;
}) {
  return (
    <>
      {props.items.map((item) => {
        const box = props.boxOf.get(item.id);
        if (!box) return null;
        const selected = props.selectedId === item.id;
        const types = (item.types ?? []).slice(0, 6);
        const desc = (item.description ?? '').trim();
        const cy = box.y + box.h / 2;
        const nameY = desc !== '' ? box.y + 19 : types.length > 0 ? cy - 4 : cy;
        const dotsY = desc !== '' ? box.y + box.h - 6 : box.y + box.h - 7;
        const renaming = props.renamingId === item.id;
        return (
          <g
            key={item.id}
            className={selected ? 'node bnode on' : 'node bnode'}
            data-node-id={item.id}
            role="button"
            aria-label={item.label}
            onClick={() => props.onSelect(item.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              props.onActivate(item.id);
            }}
            onPointerEnter={() => props.onPointerEnter(item.id)}
            onPointerLeave={props.onPointerLeave}
            onPointerDown={props.onPointerDown}
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
            {props.onBeginLink ? (
              <circle
                className="bnode-handle"
                cx={box.x + box.w}
                cy={cy}
                r={5}
                onPointerDown={(event) => props.onBeginLink?.(event, item.id)}
              />
            ) : null}
            <title>{item.label}</title>
          </g>
        );
      })}
    </>
  );
}
