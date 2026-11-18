import type { EdgeAppearance } from '@unfold/dto';
import { useState } from 'react';
import { LABEL_LIFT, arrowPath } from './edge-geometry.js';
import { EDGE_DASH, EDGE_STROKE, EDGE_WIDTH } from './edge-style.js';
import { shortLabel } from './label.js';
import {
  branchCurve,
  branchDraw,
  branchPairs,
  cubicAt,
  linksOnBranch,
  orientBranch,
  type BranchBox,
  type BranchItem,
} from './branch-geometry.js';

type BranchLink = { id: string; fromId: string; toId: string; label: string; count?: number };

/** 顺着来向收成尖。又宽又横的三角会插在弯线上。 */
const BRANCH_ARROW_LEN = 10;
const BRANCH_ARROW_HALF = 3.5;

function branchArrow(stroke: { end: { x: number; y: number }; tip: { x: number; y: number; ux: number; uy: number } }): string {
  const len = Math.hypot(stroke.tip.x - stroke.end.x, stroke.tip.y - stroke.end.y);
  return arrowPath(stroke.tip, len, BRANCH_ARROW_HALF);
}

function labelLift(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: -1 };
  let x = -dy / len;
  let y = dx / len;
  if (y > 0) {
    x = -x;
    y = -y;
  }
  return { x, y };
}

export function BranchLines(props: {
  items: readonly BranchItem[];
  boxOf: ReadonlyMap<string, BranchBox>;
  links?: readonly BranchLink[];
  selectedId?: string | null;
  editingId?: string | null;
  appearance?: EdgeAppearance;
  showMarkers?: boolean;
  onSelectLink?: (id: string) => void;
  onActivateLink?: (id: string) => void;
  /** 还没有联系时，双击分支写下从父到子的关系。 */
  onEditPlain?: (pair: { parentId: string; childId: string }) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const pairs = branchPairs(props.items, props.boxOf);
  if (pairs.length === 0) return null;
  const links = props.links ?? [];
  const appearance = props.appearance;
  return (
    <g className="bbranch">
      {pairs.map((pair) => {
        const parent = props.boxOf.get(pair.parentId);
        const child = props.boxOf.get(pair.childId);
        if (!parent || !child) return null;
        const saved = linksOnBranch(pair, links);
        const base = branchCurve(parent, child);
        if (saved.length === 0) {
          const stroke = branchDraw(base, BRANCH_ARROW_LEN);
          return (
            <g
              key={pair.childId}
              className="node bbranch-plain"
              onDoubleClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                props.onEditPlain?.(pair);
              }}
              onContextMenu={(event) => {
                event.stopPropagation();
                event.preventDefault();
                props.onEditPlain?.(pair);
              }}
            >
              <path className="bbranch-hit" d={stroke.d} />
              <path className="bbranch-struct" d={stroke.d} />
              <path className="bbranch-struct-arrow" d={branchArrow(stroke)} />
            </g>
          );
        }
        return saved.map((link) => {
          const forward = link.fromId === pair.parentId && link.toId === pair.childId;
          const curve = orientBranch(base, forward);
          const stroke = branchDraw(curve, BRANCH_ARROW_LEN);
          const mid = cubicAt(curve, 0.5);
          const lift = labelLift(curve.p0, curve.p3);
          const selected = props.selectedId === link.id;
          const hovered = hoveredId === link.id;
          const ink = appearance ? EDGE_STROKE[appearance.color] : null;
          const color = selected ? 'var(--accent)' : hovered && ink ? ink.hover : (ink?.line ?? 'var(--mute)');
          const width = appearance ? EDGE_WIDTH[appearance.width] : 1.25;
          const dash = appearance ? EDGE_DASH[appearance.dash] : undefined;
          const showText = props.editingId !== link.id && link.label !== '';
          const count = link.count ?? 0;
          return (
            <g
              key={link.id}
              className={selected ? 'node bbranch-rel on' : 'node bbranch-rel'}
              data-edge-id={link.id}
              role="button"
              aria-label={link.label === '' ? '关系' : link.label}
              onClick={() => props.onSelectLink?.(link.id)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                props.onActivateLink?.(link.id);
              }}
              onPointerEnter={() => setHoveredId(link.id)}
              onPointerLeave={() => setHoveredId((current) => (current === link.id ? null : current))}
            >
              <path className="bbranch-hit" d={stroke.d} />
              <path
                className="bbranch-line"
                d={stroke.d}
                stroke={color}
                strokeWidth={selected ? width + 2.4 : width}
                strokeDasharray={dash}
                strokeLinecap="butt"
              />
              <path className="bbranch-arrow" d={branchArrow(stroke)} fill={color} />
              {showText ? (
                <text
                  className="bedge-label"
                  x={mid.x + lift.x * LABEL_LIFT}
                  y={mid.y + lift.y * LABEL_LIFT}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {shortLabel(link.label)}
                  {props.showMarkers && count > 0 ? (
                    <tspan className="cnt" dx={5}>
                      ·{count}
                    </tspan>
                  ) : null}
                </text>
              ) : null}
            </g>
          );
        });
      })}
    </g>
  );
}
