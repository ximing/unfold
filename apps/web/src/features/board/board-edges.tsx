import type { EdgeAppearance } from '@unfold/dto';
import { useState } from 'react';
import type { BoardCanvasLink } from './board-canvas.js';
import type { BoardBox } from './board-layout.js';
import { ARROW_LEN, arrowPath, edgeDraw, edgeLanes, type EdgeRoute } from './edge-geometry.js';
import { EDGE_DASH, EDGE_STROKE, EDGE_WIDTH } from './edge-style.js';
import { shortLabel } from './label.js';

export function BoardEdges(props: {
  links: BoardCanvasLink[];
  boxOf: Map<string, BoardBox>;
  selectedId: string | null;
  editingId?: string | null;
  appearance: EdgeAppearance;
  route: EdgeRoute;
  labels: 'always' | 'focus';
  showMarkers: boolean;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const lanes = edgeLanes(props.links);
  const width = EDGE_WIDTH[props.appearance.width];
  const dash = EDGE_DASH[props.appearance.dash];
  return (
    <>
      {props.links.map((link) => {
        const from = props.boxOf.get(link.fromId);
        const to = props.boxOf.get(link.toId);
        if (!from || !to) return null;
        const lane = lanes.get(link.id) ?? { index: 0, count: 1, paired: false };
        const withArrow = props.appearance.arrow === 'end';
        const full = edgeDraw(from, to, lane.index, lane.count, lane.paired, props.route);
        const stroke = withArrow
          ? edgeDraw(from, to, lane.index, lane.count, lane.paired, props.route, ARROW_LEN)
          : full;
        const cap = withArrow ? 'butt' : 'round';
        const selected = props.selectedId === link.id;
        const hovered = hoveredId === link.id;
        const ink = EDGE_STROKE[props.appearance.color];
        const color = hovered && !selected ? ink.hover : ink.line;
        const focused = props.labels === 'focus' && !selected && !hovered;
        const count = link.count ?? 0;
        const showText =
          props.editingId !== link.id && !focused && (link.label !== '' || (props.showMarkers && count > 0));
        return (
          <g
            key={link.id}
            className={selected ? 'node bedge-g on' : 'node bedge-g'}
            data-edge-id={link.id}
            role="button"
            aria-label={link.label === '' ? '关系' : link.label}
            onClick={() => props.onSelect(link.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onActivate?.(link.id);
            }}
            onPointerEnter={() => setHoveredId(link.id)}
            onPointerLeave={() => setHoveredId((current) => (current === link.id ? null : current))}
          >
            <path className="bedge-hit" d={full.d} />
            {selected ? (
              <path
                d={stroke.d}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={width + 2.4}
                strokeLinecap={cap}
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ) : null}
            <path
              className="bedge"
              d={stroke.d}
              style={{
                stroke: color,
                strokeWidth: width,
                strokeDasharray: dash,
              }}
              strokeLinecap={cap}
              strokeLinejoin="round"
            />
            {withArrow ? (
              <path d={arrowPath(stroke.tip)} fill={color} stroke="none" pointerEvents="none" />
            ) : null}
            {showText ? (
              <text className="bedge-label" x={full.label.x} y={full.label.y - 9} textAnchor="middle">
                {shortLabel(link.label)}
                {props.showMarkers && count > 0 ? (
                  <tspan className="cnt" dx={link.label === '' ? 0 : 5}>
                    ·{count}
                  </tspan>
                ) : null}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
}
