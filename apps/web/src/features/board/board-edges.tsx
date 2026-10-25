import type { BoardCanvasLink } from './board-canvas.js';
import type { BoardBox } from './board-layout.js';
import { shortLabel } from './label.js';

export function BoardEdges(props: {
  links: BoardCanvasLink[];
  boxOf: Map<string, BoardBox>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {props.links.map((link) => {
        const from = props.boxOf.get(link.fromId);
        const to = props.boxOf.get(link.toId);
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
            onClick={() => props.onSelect(link.id)}
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
    </>
  );
}
