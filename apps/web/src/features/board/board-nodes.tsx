import type { PointerEvent as ReactPointerEvent } from 'react';
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

export function BoardNodes(props: {
  items: BoardCanvasItem[];
  boxOf: Map<string, BoardBox>;
  imageHeights: ReadonlyMap<string, number>;
  selectedId: string | null;
  renamingId: string | null;
  onSelect: (id: string) => void;
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
  return (
    <>
      {props.items.map((item) => {
        const box = props.boxOf.get(item.id);
        if (!box) return null;
        if (item.kind === 'image') {
          const pictureH = props.imageHeights.get(item.id) ?? Math.max(1, box.h - IMAGE_NAME_LINE);
          return (
            <ImageNode
              key={item.id}
              item={item}
              box={box}
              pictureH={pictureH}
              selected={props.selectedId === item.id}
              renaming={props.renamingId === item.id}
              onSelect={props.onSelect}
              onActivate={props.onActivate}
              onPointerEnter={props.onPointerEnter}
              onPointerLeave={props.onPointerLeave}
              onPointerDown={props.onPointerDown}
              onDragPointerDown={props.onDragPointerDown}
              onBeginLink={props.onBeginLink}
              onBeginResizeImage={props.onBeginResizeImage}
              onImageLoad={props.onImageLoad}
              showMarkers={showMarkers}
            />
          );
        }
        const selected = props.selectedId === item.id;
        const types = showMarkers ? (item.types ?? []).slice(0, 6) : [];
        const desc = (item.description ?? '').trim();
        const cy = box.y + box.h / 2;
        const nameY = desc !== '' ? box.y + 15 : types.length > 0 ? cy - 4 : cy;
        const dotsY = desc !== '' ? box.y + box.h - 8 : box.y + box.h - 7;
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
            onPointerDown={(event) => {
              props.onPointerDown();
              props.onDragPointerDown?.(event, item.id);
            }}
          >
            <rect className="bnode-rect" x={box.x} y={box.y} width={box.w} height={box.h} rx={11} />
            {!renaming ? (
              <text className="bnode-name" x={box.x + box.w / 2} y={nameY} textAnchor="middle">
                {shortLabel(item.label)}
              </text>
            ) : null}
            {desc !== '' && !renaming ? (
              <foreignObject
                className="bnode-desc-fo"
                x={box.x + 10}
                y={box.y + 28}
                width={Math.max(0, box.w - 20)}
                height={28}
              >
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
            {props.onBeginLink ? (
              <LinkHandles box={box} id={item.id} onBeginLink={props.onBeginLink} />
            ) : null}
            <title>{item.label}</title>
          </g>
        );
      })}
    </>
  );
}

function ImageNode(props: {
  item: BoardCanvasItem;
  box: BoardBox;
  pictureH: number;
  selected: boolean;
  renaming: boolean;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  onPointerEnter: (id: string) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onDragPointerDown?: (event: ReactPointerEvent, id: string) => void;
  onBeginLink?: (event: ReactPointerEvent, id: string) => void;
  onBeginResizeImage?: (event: ReactPointerEvent, id: string) => void;
  onImageLoad?: (assetId: string, naturalWidth: number, naturalHeight: number) => void;
  showMarkers: boolean;
}) {
  const { item, box, pictureH } = props;
  const types = (item.types ?? []).slice(0, 6);
  const nameY = box.y + pictureH + IMAGE_NAME_LINE / 2;
  const dotsY = box.y + pictureH - 6;
  const assetId = item.assetId ? item.assetId : '';
  const clipId = `bimg-${item.id}`;
  return (
    <g
      className={props.selected ? 'node bnode bnode-image on' : 'node bnode bnode-image'}
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
      onPointerDown={(event) => {
        props.onPointerDown();
        props.onDragPointerDown?.(event, item.id);
      }}
    >
      {assetId !== '' ? (
        <clipPath id={clipId}>
          <rect x={box.x} y={box.y} width={box.w} height={pictureH} rx={11} />
        </clipPath>
      ) : null}
      <rect className="bnode-rect" x={box.x} y={box.y} width={box.w} height={box.h} rx={11} />
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
                props.onImageLoad?.(assetId, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
              }}
            />
          </div>
        </foreignObject>
      ) : null}
      <rect className="bnode-image-frame" x={box.x} y={box.y} width={box.w} height={box.h} rx={11} />
      {!props.renaming ? (
        <text className="bnode-name" x={box.x + box.w / 2} y={nameY} textAnchor="middle">
          {shortLabel(item.label)}
        </text>
      ) : null}
      {props.showMarkers && types.length > 0
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
      {props.showMarkers && (item.count ?? 0) > 0
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
      {props.onBeginLink ? <LinkHandles box={box} id={item.id} onBeginLink={props.onBeginLink} /> : null}
      {props.selected && props.onBeginResizeImage ? (
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
            props.onPointerDown();
            props.onBeginResizeImage?.(event, item.id);
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
}
