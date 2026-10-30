import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { INCLUSION_TITLE } from '@unfold/dto';
import { inclusionItemId } from './inclusion-view.js';
import { shortLabel } from './label.js';
import './inclusion-frame.css';

export type InclusionFrameView = {
  childId: string;
  title: string;
  labels: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
};

export function InclusionFrames(props: {
  frames: InclusionFrameView[];
  selectedId: string | null;
  selectedIds?: readonly string[];
  layer: 'back' | 'front';
  onSelect: (id: string, event: ReactMouseEvent) => void;
  onActivate: (id: string) => void;
  onPointerDown: (event: ReactPointerEvent, frame: InclusionFrameView) => void;
}) {
  if (props.layer === 'back') {
    return (
      <>
        {props.frames.map((frame) => (
          <rect
            key={frame.childId}
            className="inclusion-frame"
            x={frame.x}
            y={frame.y}
            width={frame.w}
            height={frame.h}
            rx={14}
            pointerEvents="none"
          />
        ))}
      </>
    );
  }

  return (
    <>
      {props.frames.map((frame) => {
        const id = inclusionItemId(frame.childId);
        const selected = props.selectedIds ? props.selectedIds.includes(id) : props.selectedId === id;
        return (
          <g
            key={frame.childId}
            className={selected ? 'node inclusion-title on' : 'node inclusion-title'}
            data-node-id={id}
            role="button"
            aria-label={`子集合 ${frame.title}`}
            onClick={(event) => props.onSelect(id, event)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              props.onActivate(id);
            }}
            onPointerDown={(event) => props.onPointerDown(event, frame)}
          >
            <rect x={frame.x} y={frame.y} width={frame.w} height={INCLUSION_TITLE} rx={10} />
            <text x={frame.x + 12} y={frame.y + INCLUSION_TITLE / 2}>
              {shortLabel(frame.title)}
            </text>
            {frame.labels.length > 0 ? (
              <text className="rel" x={frame.x + frame.w - 12} y={frame.y + INCLUSION_TITLE / 2} textAnchor="end">
                {shortLabel(frame.labels.join('、'))}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
}
