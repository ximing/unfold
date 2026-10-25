import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { UContextMenu } from '../../shared/ui/context-menu/context-menu.js';
import './graph-viewport.css';

type Transform = { k: number; tx: number; ty: number };

const MIN_K = 0.2;
const MAX_K = 3;
const MINI_W = 160;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function zoomAt(t: Transform, px: number, py: number, factor: number): Transform {
  const k = clamp(t.k * factor, MIN_K, MAX_K);
  const ratio = k / t.k;
  return { k, tx: px - (px - t.tx) * ratio, ty: py - (py - t.ty) * ratio };
}

export type GraphViewportProps = {
  /** 世界坐标范围（内容坐标系） */
  worldX: number;
  worldY: number;
  worldWidth: number;
  worldHeight: number;
  /** 变化时复位到适应屏幕（比如切换焦点对象） */
  resetKey?: string;
  className?: string;
  children: ReactNode;
  /** minimap 里画的内容（世界坐标系） */
  minimap?: ReactNode;
  /** 双击空白处（世界坐标）。给了它，双击空白就不再缩放 */
  onBackgroundDoubleClick?: (point: { worldX: number; worldY: number }) => void;
};

export function GraphViewport(props: GraphViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState<Transform>({ k: 1, tx: 0, ty: 0 });
  const [panning, setPanning] = useState(false);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const initRef = useRef('');

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (size.w === 0 || size.h === 0) return;
    const k = clamp(Math.min(size.w / props.worldWidth, size.h / props.worldHeight, 1), MIN_K, MAX_K);
    setT({
      k,
      tx: size.w / 2 - (props.worldX + props.worldWidth / 2) * k,
      ty: size.h / 2 - (props.worldY + props.worldHeight / 2) * k,
    });
  }, [size.w, size.h, props.worldX, props.worldY, props.worldWidth, props.worldHeight]);

  // 首次测量到尺寸、以及 resetKey 变化时复位
  useEffect(() => {
    const key = props.resetKey ?? '';
    if (size.w === 0 || size.h === 0) return;
    if (initRef.current === key) return;
    initRef.current = key;
    fit();
  }, [fit, props.resetKey, size.w, size.h]);

  // 触控板：双指滚动平移，捏合（ctrlKey wheel）缩放；鼠标滚轮平移，⌘/ctrl+滚轮缩放
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const factor = Math.exp(-event.deltaY * 0.0022);
        setT((current) => zoomAt(current, px, py, factor));
        return;
      }
      setT((current) => ({ ...current, tx: current.tx - event.deltaX, ty: current.ty - event.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.node')) return;
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    setT((current) => ({ ...current, tx: current.tx + dx, ty: current.ty + dy }));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPanning(false);
  }

  function zoomButton(factor: number) {
    setT((current) => zoomAt(current, size.w / 2, size.h / 2, factor));
  }

  // minimap：点击/拖动把主视口中心移过去
  function miniJump(event: ReactPointerEvent<HTMLDivElement>) {
    const el = miniRef.current;
    if (!el || size.w === 0) return;
    const rect = el.getBoundingClientRect();
    const wx = props.worldX + ((event.clientX - rect.left) / rect.width) * props.worldWidth;
    const wy = props.worldY + ((event.clientY - rect.top) / rect.height) * props.worldHeight;
    setT((current) => ({ ...current, tx: size.w / 2 - wx * current.k, ty: size.h / 2 - wy * current.k }));
  }

  function onMiniDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    miniJump(event);
  }

  function onMiniMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.buttons !== 1) return;
    miniJump(event);
  }

  const miniH = Math.max(40, (props.worldHeight / props.worldWidth) * MINI_W);
  const vpX = -t.tx / t.k;
  const vpY = -t.ty / t.k;
  const vpW = size.w / t.k;
  const vpH = size.h / t.k;

  return (
    <div
      ref={hostRef}
      className="gvp"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('.node')) return;
        if (props.onBackgroundDoubleClick) {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          props.onBackgroundDoubleClick({ worldX: (px - t.tx) / t.k, worldY: (py - t.ty) / t.k });
          return;
        }
        zoomButton(1.35);
      }}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest('.node')) return;
        event.preventDefault();
        setBgMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <svg
        className={`gvp-canvas ${props.className ?? ''} ${panning ? 'panning' : ''}`.trim()}
        role="img"
        aria-label="可缩放的图"
      >
        <g transform={`translate(${t.tx} ${t.ty}) scale(${t.k})`}>{props.children}</g>
      </svg>
      <div className="gvp-tools">
        <button type="button" aria-label="缩小" onClick={() => zoomButton(1 / 1.3)}>
          −
        </button>
        <span className="zoom-pct">{Math.round(t.k * 100)}%</span>
        <button type="button" aria-label="放大" onClick={() => zoomButton(1.3)}>
          +
        </button>
        <button type="button" aria-label="适应屏幕" title="适应屏幕" onClick={fit}>
          ⤢
        </button>
      </div>
      {props.minimap ? (
        <div
          ref={miniRef}
          className="gvp-minimap"
          onPointerDown={onMiniDown}
          onPointerMove={onMiniMove}
        >
          <svg
            width={MINI_W}
            height={miniH}
            viewBox={`${props.worldX} ${props.worldY} ${props.worldWidth} ${props.worldHeight}`}
          >
            {props.minimap}
            <rect className="vp-rect" x={vpX} y={vpY} width={vpW} height={vpH} />
          </svg>
        </div>
      ) : null}
      {bgMenu ? (
        <UContextMenu
          x={bgMenu.x}
          y={bgMenu.y}
          onClose={() => setBgMenu(null)}
          items={[
            { label: '放大', hint: '双击', onSelect: () => zoomButton(1.3) },
            { label: '缩小', onSelect: () => zoomButton(1 / 1.3) },
            { label: '适应屏幕', onSelect: fit },
          ]}
        />
      ) : null}
    </div>
  );
}
