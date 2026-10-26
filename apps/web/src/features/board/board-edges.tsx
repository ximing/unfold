import type { BoardCanvasLink } from './board-canvas.js';
import type { BoardBox } from './board-layout.js';
import { edgeGeometry, edgeLanes, edgeMidpoint } from './edge-geometry.js';
import { shortLabel } from './label.js';

export function BoardEdges(props: {
  links: BoardCanvasLink[];
  boxOf: Map<string, BoardBox>;
  selectedId: string | null;
  editingId?: string | null;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
}) {
  const lanes = edgeLanes(props.links);
  return (
    <>
      {props.links.map((link) => {
        const from = props.boxOf.get(link.fromId);
        const to = props.boxOf.get(link.toId);
        if (!from || !to) return null;
        const lane = lanes.get(link.id) ?? { index: 0, count: 1, paired: false };
        const seg = edgeGeometry(from, to, lane.index, lane.count, lane.paired);
        const mid = edgeMidpoint(seg);
        const selected = props.selectedId === link.id;
        return (
          <g
            key={link.id}
            className={selected ? 'node bedge-g on' : 'node bedge-g'}
            role="button"
            aria-label={link.label === '' ? '关系' : link.label}
            onClick={() => props.onSelect(link.id)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onActivate?.(link.id);
            }}
          >
            <line className="bedge-hit" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} />
            <line
              className="bedge"
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              markerEnd={selected ? 'url(#board-arrow-on)' : 'url(#board-arrow)'}
            />
            {props.editingId === link.id || (link.label === '' && (link.count ?? 0) === 0) ? null : (
              <text className="bedge-label" x={mid.x} y={mid.y - 9} textAnchor="middle">
                {shortLabel(link.label)}
                {(link.count ?? 0) > 0 ? <tspan className="cnt" dx={link.label === '' ? 0 : 5}>·{link.count}</tspan> : null}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}
