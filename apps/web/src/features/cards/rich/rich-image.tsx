import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  RICH_IMAGE_MAX_WIDTH,
  RICH_IMAGE_MIN_WIDTH,
  richImageDisplayWidth,
  richImageWidthCommit,
} from './rich-image-size.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assetSrc(id: string): string {
  return UUID.test(id) ? `/api/assets/${id}` : '';
}

function readAssetId(element: HTMLElement): string | null {
  const explicit = element.getAttribute('data-asset') ?? '';
  if (UUID.test(explicit)) return explicit.toLowerCase();
  const match = /\/api\/assets\/([0-9a-f-]{36})/i.exec(element.getAttribute('src') ?? '');
  if (match?.[1] && UUID.test(match[1])) return match[1].toLowerCase();
  return null;
}

function storedWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nodePos(getPos: ReactNodeViewProps['getPos']): number | undefined {
  if (typeof getPos !== 'function') return undefined;
  try {
    const pos = getPos();
    return typeof pos === 'number' ? pos : undefined;
  } catch {
    return undefined;
  }
}

function ImageView(props: ReactNodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ stop: () => void } | null>(null);
  const commitRef = useRef(props.updateAttributes);
  const pendingRef = useRef<number | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  commitRef.current = props.updateAttributes;

  const stored = storedWidth(props.node.attrs.width);

  useEffect(() => {
    return () => dragRef.current?.stop();
  }, []);

  useEffect(() => {
    if (pendingRef.current === null || stored !== pendingRef.current) return;
    pendingRef.current = null;
    setDragWidth(null);
  }, [stored]);

  const src = typeof props.node.attrs.src === 'string' ? props.node.attrs.src : '';
  const alt = typeof props.node.attrs.alt === 'string' ? props.node.attrs.alt : '';
  const shown = dragWidth ?? stored;
  const className = ['rich-image', props.selected ? 'is-selected' : '', dragging ? 'is-resizing' : '']
    .filter(Boolean)
    .join(' ');

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !props.editor.isEditable) return;
    const img = imgRef.current;
    const frame = frameRef.current;
    const host = frame?.closest('.node-image');
    const limit = host instanceof HTMLElement ? host.clientWidth : 0;
    if (!img || !frame || limit < RICH_IMAGE_MIN_WIDTH) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = nodePos(props.getPos);
    if (pos !== undefined) props.editor.commands.setNodeSelection(pos);

    const startWidth = img.offsetWidth;
    const seen = img.getBoundingClientRect().width;
    // 检查器入场时有缩放，用画面宽度和 CSS 宽度的比把指针位移换回去。
    const scale = startWidth > 0 && seen > 0 ? seen / startWidth : 1;
    const originX = event.clientX;
    const pointerId = event.pointerId;
    let stopped = false;
    setDragging(true);

    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (dragRef.current?.stop === stop) dragRef.current = null;
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) ev.preventDefault();
      setDragWidth(richImageDisplayWidth(startWidth, ev.clientX - originX, limit, scale));
    };
    const finish = (ev: PointerEvent, commit: boolean) => {
      if (ev.pointerId !== pointerId) return;
      const delta = ev.clientX - originX;
      const next = richImageWidthCommit(startWidth, delta, richImageDisplayWidth(startWidth, delta, limit, scale));
      stop();
      setDragging(false);
      if (commit && next !== null && next !== stored) {
        pendingRef.current = next;
        setDragWidth(next);
        commitRef.current({ width: next });
        return;
      }
      pendingRef.current = null;
      setDragWidth(null);
    };
    const onUp = (ev: PointerEvent) => finish(ev, true);
    const onCancel = (ev: PointerEvent) => finish(ev, false);

    dragRef.current?.stop();
    dragRef.current = { stop };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  return (
    <NodeViewWrapper className={className}>
      <div className="rich-image-frame" ref={frameRef}>
        <img
          ref={imgRef}
          data-rich-image=""
          data-asset={src}
          src={assetSrc(src)}
          alt={alt}
          draggable={false}
          style={shown !== null ? { width: shown } : undefined}
        />
        {dragging && dragWidth !== null ? (
          <span className="rich-image-size" aria-hidden="true">
            {dragWidth}
          </span>
        ) : null}
        {props.editor.isEditable ? (
          <div
            className="rich-image-resize"
            role="button"
            aria-label="调整图片宽度"
            title="拖动调整宽度"
            contentEditable={false}
            onPointerDown={begin}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

/** src 只存资源 id，显示地址在渲染时再拼。 */
export const RichImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return {
      src: { default: null, rendered: false },
      alt: { default: null, rendered: false },
      width: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-rich-image]',
        getAttrs(dom) {
          if (!(dom instanceof HTMLElement)) return false;
          const id = readAssetId(dom);
          if (!id) return false;
          const text = (dom.getAttribute('alt') ?? '').trim().slice(0, 200);
          const width = Number(dom.getAttribute('width'));
          const attrs: { src: string; alt?: string; width?: number } = { src: id };
          if (text !== '') attrs.alt = text;
          if (Number.isFinite(width) && width >= RICH_IMAGE_MIN_WIDTH && width <= RICH_IMAGE_MAX_WIDTH) {
            attrs.width = width;
          }
          return attrs;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const id = typeof node.attrs.src === 'string' ? node.attrs.src : '';
    const text = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
    const width = node.attrs.width;
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-rich-image': 'true',
        'data-asset': id,
        src: assetSrc(id),
        alt: text,
        ...(typeof width === 'number' ? { width: String(width) } : {}),
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView, {
      stopEvent: ({ event }) => {
        const target = event.target;
        return target instanceof Element && target.closest('.rich-image-resize') !== null;
      },
    });
  },
});
