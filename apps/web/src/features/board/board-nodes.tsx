import {
  memo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { cardMeta } from '../cards/card-meta.js';
import type { BoardCanvasItem } from './board-canvas.js';
import { IMAGE_NAME_LINE } from './image-frame.js';
import type { BoardBox } from './board-layout.js';
import { shortLabel } from './label.js';

const LINK_HANDLES = [
  { side: 'up', label: '向上连线', cx: (box: BoardBox) => box.x + box.w / 2, cy: (box: BoardBox) => box.y },
  { side: 'right', label: '向右连线', cx: (box: BoardBox) => box.x + box.w, cy: (box: BoardBox) => box.y + box.h / 2 },
  { side: 'down', label: '向下连线', cx: (box: BoardBox) => box.x + box.w / 2, cy: (box: BoardBox) => box.y + box.h },
  { side: 'left', label: '向左连线', cx: (box: BoardBox) => box.x, cy: (box: BoardBox) => box.y + box.h / 2 },
] as const;

/** 卡片底和选中光晕。不用 CSS filter，拖动和缩放时滤镜会在画布上留下残影。光晕只在选中时挂上。 */
export function NodeChrome(props: { x: number; y: number; w: number; h: number; selected: boolean }) {
  const { x, y, w, h, selected } = props;
  return (
    <>
      {selected ? (
        <>
          <rect className="bnode-glow bnode-glow-outer" x={x - 5} y={y - 3} width={w + 10} height={h + 10} rx={16} />
          <rect className="bnode-glow bnode-glow-inner" x={x - 2} y={y} width={w + 4} height={h + 5} rx={13} />
        </>
      ) : (
        <rect className="bnode-shade" x={x} y={y + 1} width={w} height={h} rx={11} />
      )}
      <rect className="bnode-rect" x={x} y={y} width={w} height={h} rx={11} />
    </>
  );
}

function LinkHandles(props: {
  box: BoardBox;
  id: string;
  onBeginLink: (event: ReactPointerEvent, id: string) => void;
}) {
  return LINK_HANDLES.map((spot) => (
    <circle
      key={spot.side}
      className="bnode-handle"
      data-side={spot.side}
      role="button"
      aria-label={spot.label}
      cx={spot.cx(props.box)}
      cy={spot.cy(props.box)}
      r={6}
      onPointerDown={(event) => props.onBeginLink(event, props.id)}
    />
  ));
}

type NodeHandlers = {
  onSelect: (id: string, event: ReactMouseEvent) => void;
  onActivate: (id: string) => void;
  onPointerEnter: (id: string) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onDragPointerDown?: (event: ReactPointerEvent, id: string) => void;
  onBeginLink?: (event: ReactPointerEvent, id: string) => void;
  onBeginResizeImage?: (event: ReactPointerEvent, id: string) => void;
  onImageLoad?: (assetId: string, naturalWidth: number, naturalHeight: number) => void;
};

type NodeApi = {
  handlers: NodeHandlers;
  hover: (id: string) => void;
  clearHover: (id: string) => void;
};

function sameList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function sameBox(left: BoardBox, right: BoardBox): boolean {
  return left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
}

function sameFace(left: BoardCanvasItem, right: BoardCanvasItem): boolean {
  return (
    left.label === right.label &&
    left.description === right.description &&
    (left.count ?? 0) === (right.count ?? 0) &&
    sameList(left.types, right.types)
  );
}

function nodeEvents(apiRef: RefObject<NodeApi | null>, id: string) {
  return {
    onClick: (event: ReactMouseEvent) => apiRef.current?.handlers.onSelect(id, event),
    onDoubleClick: (event: ReactMouseEvent) => {
      event.stopPropagation();
      apiRef.current?.handlers.onActivate(id);
    },
    onPointerEnter: () => apiRef.current?.hover(id),
    onPointerLeave: () => apiRef.current?.clearHover(id),
    onPointerDown: (event: ReactPointerEvent) => {
      const handlers = apiRef.current?.handlers;
      handlers?.onPointerDown();
      handlers?.onDragPointerDown?.(event, id);
    },
  };
}

export function BoardNodes(props: {
  items: BoardCanvasItem[];
  boxOf: Map<string, BoardBox>;
  imageHeights: ReadonlyMap<string, number>;
  selectedId: string | null;
  selectedIds?: readonly string[];
  renamingId: string | null;
  onSelect: (id: string, event: ReactMouseEvent) => void;
  onActivate: (id: string) => void;
  onPointerEnter: (id: string) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onDragPointerDown?: (event: ReactPointerEvent, id: string) => void;
  onBeginLink?: (event: ReactPointerEvent, id: string) => void;
  onBeginResizeImage?: (event: ReactPointerEvent, id: string) => void;
  onImageLoad?: (assetId: string, naturalWidth: number, naturalHeight: number) => void;
  /** 关掉后不画卡片数和类型色点。全貌始终打开，用来显示成员点数 */
  showMarkers?: boolean;
}) {
  const showMarkers = props.showMarkers !== false;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const apiRef = useRef<NodeApi | null>(null);
  apiRef.current = {
    handlers: props,
    hover(id) {
      if (props.onBeginLink) setHoveredId(id);
      props.onPointerEnter(id);
    },
    clearHover(id) {
      if (props.onBeginLink) setHoveredId((current) => (current === id ? null : current));
      props.onPointerLeave();
    },
  };
  return (
    <>
      {props.items.map((item) => {
        const box = props.boxOf.get(item.id);
        if (!box) return null;
        const selected = props.selectedIds ? props.selectedIds.includes(item.id) : props.selectedId === item.id;
        const renaming = props.renamingId === item.id;
        const showHandles = hoveredId === item.id && props.onBeginLink !== undefined;
        if (item.face === 'inclusion') {
          return <InclusionNode key={item.id} item={item} box={box} selected={selected} apiRef={apiRef} />;
        }
        if (item.kind === 'image') {
          return (
            <ImageNode
              key={item.id}
              item={item}
              box={box}
              pictureH={props.imageHeights.get(item.id) ?? Math.max(1, box.h - IMAGE_NAME_LINE)}
              selected={selected}
              renaming={renaming}
              showHandles={showHandles}
              showMarkers={showMarkers}
              canResize={props.onBeginResizeImage !== undefined}
              apiRef={apiRef}
            />
          );
        }
        return (
          <TextNode
            key={item.id}
            item={item}
            box={box}
            selected={selected}
            renaming={renaming}
            showHandles={showHandles}
            showMarkers={showMarkers}
            apiRef={apiRef}
          />
        );
      })}
    </>
  );
}

const InclusionNode = memo(function InclusionNode(props: {
  item: BoardCanvasItem;
  box: BoardBox;
  selected: boolean;
  apiRef: RefObject<NodeApi | null>;
}) {
  const { item, box, selected, apiRef } = props;
  const desc = (item.description ?? '').trim();
  const nameY = desc !== '' ? box.y + 15 : box.y + box.h / 2;
  return (
    <g
      className={selected ? 'node bnode bnode-inclusion on' : 'node bnode bnode-inclusion'}
      data-node-id={item.id}
      role="button"
      aria-label={item.label}
      {...nodeEvents(apiRef, item.id)}
    >
      <NodeChrome x={box.x} y={box.y} w={box.w} h={box.h} selected={selected} />
      <text className="bnode-name" x={box.x + box.w / 2} y={nameY} textAnchor="middle">
        {shortLabel(item.label)}
      </text>

      {desc !== '' ? (
        <foreignObject className="bnode-desc-fo" x={box.x + 10} y={box.y + 28} width={Math.max(0, box.w - 20)} height={28}>
          <div className="bnode-desc" style={{ width: Math.max(0, box.w - 20) }}>
            {desc}
          </div>
        </foreignObject>
      ) : null}
      <title>{item.label}</title>
    </g>
  );
}, (prev, next) => prev.selected === next.selected && sameBox(prev.box, next.box) && sameFace(prev.item, next.item));

const TextNode = memo(function TextNode(props: {
  item: BoardCanvasItem;
  box: BoardBox;
  selected: boolean;
  renaming: boolean;
  showHandles: boolean;
  showMarkers: boolean;
  apiRef: RefObject<NodeApi | null>;
}) {
  const { item, box, selected, renaming, showHandles, showMarkers, apiRef } = props;
  const types = showMarkers ? (item.types ?? []).slice(0, 6) : [];
  const desc = (item.description ?? '').trim();
  const cy = box.y + box.h / 2;
  const nameY = desc !== '' ? box.y + 15 : types.length > 0 ? cy - 4 : cy;
  const dotsY = desc !== '' ? box.y + box.h - 8 : box.y + box.h - 7;
  // 改名时节点框就是编辑容器，即使选中态还没跟上也要画上编辑描边。
  const editing = selected || renaming;
  return (
    <g
      className={editing ? 'node bnode on' : 'node bnode'}
      data-node-id={item.id}
      role="button"
      aria-label={item.label}
      {...nodeEvents(apiRef, item.id)}
    >
      <NodeChrome x={box.x} y={box.y} w={box.w} h={box.h} selected={editing} />
      {!renaming ? (
        <text className="bnode-name" x={box.x + box.w / 2} y={nameY} textAnchor="middle">
          {shortLabel(item.label)}
        </text>
      ) : null}
      {desc !== '' && !renaming ? (
        <foreignObject className="bnode-desc-fo" x={box.x + 10} y={box.y + 28} width={Math.max(0, box.w - 20)} height={28}>
          <div className="bnode-desc" style={{ width: Math.max(0, box.w - 20) }}>
            {desc}
          </div>
        </foreignObject>
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
      {showMarkers && (item.count ?? 0) > 0
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
      {showHandles ? (
        <LinkHandles
          box={box}
          id={item.id}
          onBeginLink={(event, id) => apiRef.current?.handlers.onBeginLink?.(event, id)}
        />
      ) : null}
      <title>{item.label}</title>
    </g>
  );
}, (prev, next) =>
  prev.selected === next.selected &&
  prev.renaming === next.renaming &&
  prev.showHandles === next.showHandles &&
  prev.showMarkers === next.showMarkers &&
  sameBox(prev.box, next.box) &&
  sameFace(prev.item, next.item),
);

const ImageNode = memo(function ImageNode(props: {
  item: BoardCanvasItem;
  box: BoardBox;
  pictureH: number;
  selected: boolean;
  renaming: boolean;
  showHandles: boolean;
  showMarkers: boolean;
  canResize: boolean;
  apiRef: RefObject<NodeApi | null>;
}) {
  const { item, box, pictureH, selected, renaming, showHandles, showMarkers, canResize, apiRef } = props;
  const types = showMarkers ? (item.types ?? []).slice(0, 6) : [];
  const nameY = box.y + pictureH + IMAGE_NAME_LINE / 2;
  const dotsY = box.y + pictureH - 6;
  const assetId = item.assetId ? item.assetId : '';
  const clipId = `bimg-${item.id}`;
  const editing = selected || renaming;
  return (
    <g
      className={editing ? 'node bnode bnode-image on' : 'node bnode bnode-image'}
      data-node-id={item.id}
      role="button"
      aria-label={item.label}
      {...nodeEvents(apiRef, item.id)}
    >
      {assetId !== '' ? (
        <clipPath id={clipId}>
          <rect x={box.x} y={box.y} width={box.w} height={pictureH} rx={11} />
        </clipPath>
      ) : null}
      <NodeChrome x={box.x} y={box.y} w={box.w} h={box.h} selected={editing} />
      {item.uploading ? (
        <text className="bnode-upload" x={box.x + box.w / 2} y={box.y + pictureH / 2} textAnchor="middle">
          正在上传
        </text>
      ) : assetId !== '' ? (
        <foreignObject
          className="bnode-photo"
          x={box.x}
          y={box.y}
          width={box.w}
          height={pictureH}
          clipPath={`url(#${clipId})`}
          pointerEvents="none"
        >
          <div
            className="bnode-photo-html"
            ref={(el) => {
              el?.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
            }}
          >
            <img
              className="bnode-photo-img"
              src={'/api/assets/' + assetId}
              alt={item.label}
              draggable={false}
              onLoad={(event) => {
                const naturalWidth = event.currentTarget.naturalWidth;
                const naturalHeight = event.currentTarget.naturalHeight;
                apiRef.current?.handlers.onImageLoad?.(assetId, naturalWidth, naturalHeight);
              }}
            />
          </div>
        </foreignObject>
      ) : null}
      <rect className="bnode-image-frame" x={box.x} y={box.y} width={box.w} height={box.h} rx={11} />
      {!renaming ? (
        <text className="bnode-name" x={box.x + box.w / 2} y={nameY} textAnchor="middle">
          {shortLabel(item.label)}
        </text>
      ) : null}
      {showMarkers && types.length > 0
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
      {showMarkers && (item.count ?? 0) > 0
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
      {showHandles ? (
        <LinkHandles
          box={box}
          id={item.id}
          onBeginLink={(event, id) => apiRef.current?.handlers.onBeginLink?.(event, id)}
        />
      ) : null}
      {selected && canResize ? (
        <circle
          className="bnode-resize"
          role="button"
          aria-label="调整图片宽度"
          cx={box.x + box.w - 4}
          cy={box.y + box.h - 4}
          r={6}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            const handlers = apiRef.current?.handlers;
            handlers?.onPointerDown();
            handlers?.onBeginResizeImage?.(event, item.id);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
          }}
        />
      ) : null}
      <title>{item.label}</title>
    </g>
  );
}, (prev, next) =>
  prev.selected === next.selected &&
  prev.renaming === next.renaming &&
  prev.showHandles === next.showHandles &&
  prev.showMarkers === next.showMarkers &&
  prev.canResize === next.canResize &&
  prev.pictureH === next.pictureH &&
  sameBox(prev.box, next.box) &&
  sameFace(prev.item, next.item) &&
  prev.item.assetId === next.item.assetId &&
  prev.item.imageWidth === next.item.imageWidth &&
  prev.item.uploading === next.item.uploading,
);
