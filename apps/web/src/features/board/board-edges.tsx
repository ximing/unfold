import type { EdgeAppearance } from '@unfold/dto';
import { memo, useRef, useState, type RefObject } from 'react';
import type { BoardCanvasLink } from './board-canvas.js';
import type { BoardBox } from './board-layout.js';
import { ARROW_LEN, arrowPath, edgeDraw, edgeLanes, type EdgeRoute } from './edge-geometry.js';
import { EDGE_DASH, EDGE_STROKE, EDGE_WIDTH } from './edge-style.js';
import { shortLabel } from './label.js';

type EdgeApi = {
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
  hover: (id: string) => void;
  clearHover: (id: string) => void;
};

function sameBox(left: BoardBox, right: BoardBox): boolean {
  return left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
}

function sameAppearance(left: EdgeAppearance, right: EdgeAppearance): boolean {
  return left.color === right.color && left.width === right.width && left.dash === right.dash && left.arrow === right.arrow;
}

const EdgeView = memo(function EdgeView(props: {
  link: BoardCanvasLink;
  from: BoardBox;
  to: BoardBox;
  laneIndex: number;
  laneCount: number;
  lanePaired: boolean;
  selected: boolean;
  hovered: boolean;
  editing: boolean;
  appearance: EdgeAppearance;
  route: EdgeRoute;
  labels: 'always' | 'focus';
  showMarkers: boolean;
  apiRef: RefObject<EdgeApi | null>;
}) {
  const { link, from, to } = props;
  const withArrow = props.appearance.arrow === 'end';
  const full = edgeDraw(from, to, props.laneIndex, props.laneCount, props.lanePaired, props.route);
  const stroke = withArrow
    ? edgeDraw(from, to, props.laneIndex, props.laneCount, props.lanePaired, props.route, ARROW_LEN)
    : full;
  const cap = withArrow ? 'butt' : 'round';
  const width = EDGE_WIDTH[props.appearance.width];
  const dash = EDGE_DASH[props.appearance.dash];
  const ink = EDGE_STROKE[props.appearance.color];
  const color = props.hovered && !props.selected ? ink.hover : ink.line;
  const focused = props.labels === 'focus' && !props.selected && !props.hovered;
  const count = link.count ?? 0;
  const showText = !props.editing && !focused && (link.label !== '' || (props.showMarkers && count > 0));
  return (
    <g
      className={props.selected ? 'node bedge-g on' : 'node bedge-g'}
      data-edge-id={link.id}
      role="button"
      aria-label={link.label === '' ? '关系' : link.label}
      onClick={() => props.apiRef.current?.onSelect(link.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        props.apiRef.current?.onActivate?.(link.id);
      }}
      onPointerEnter={() => props.apiRef.current?.hover(link.id)}
      onPointerLeave={() => props.apiRef.current?.clearHover(link.id)}
    >
      <path className="bedge-hit" d={full.d} />
      {props.selected ? (
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
      {withArrow ? <path d={arrowPath(stroke.tip)} fill={color} stroke="none" pointerEvents="none" /> : null}
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
}, (prev, next) =>
  prev.selected === next.selected &&
  prev.hovered === next.hovered &&
  prev.editing === next.editing &&
  prev.route === next.route &&
  prev.labels === next.labels &&
  prev.showMarkers === next.showMarkers &&
  prev.laneIndex === next.laneIndex &&
  prev.laneCount === next.laneCount &&
  prev.lanePaired === next.lanePaired &&
  prev.link.fromId === next.link.fromId &&
  prev.link.toId === next.link.toId &&
  prev.link.label === next.link.label &&
  (prev.link.count ?? 0) === (next.link.count ?? 0) &&
  sameBox(prev.from, next.from) &&
  sameBox(prev.to, next.to) &&
  sameAppearance(prev.appearance, next.appearance),
);

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
  const apiRef = useRef<EdgeApi | null>(null);
  apiRef.current = {
    onSelect: props.onSelect,
    onActivate: props.onActivate,
    hover(id) {
      setHoveredId(id);
    },
    clearHover(id) {
      setHoveredId((current) => (current === id ? null : current));
    },
  };
  const lanes = edgeLanes(props.links);
  return (
    <>
      {props.links.map((link) => {
        const from = props.boxOf.get(link.fromId);
        const to = props.boxOf.get(link.toId);
        if (!from || !to) return null;
        const lane = lanes.get(link.id) ?? { index: 0, count: 1, paired: false };
        return (
          <EdgeView
            key={link.id}
            link={link}
            from={from}
            to={to}
            laneIndex={lane.index}
            laneCount={lane.count}
            lanePaired={lane.paired}
            selected={props.selectedId === link.id}
            hovered={hoveredId === link.id}
            editing={props.editingId === link.id}
            appearance={props.appearance}
            route={props.route}
            labels={props.labels}
            showMarkers={props.showMarkers}
            apiRef={apiRef}
          />
        );
      })}
    </>
  );
}
