import type { CardType } from '@unfold/dto';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { BoardEdges } from './board-edges.js';
import { anchorOnBorder, edgeGeometry, edgeLanes, edgeMidpoint } from './edge-geometry.js';
import { isFiniteNumber, layoutBoard, layoutPlaced, nextPlacementZ } from './board-layout.js';
import { imageFrame } from './image-frame.js';
import { BoardNodes } from './board-nodes.js';
import { BoardToolbar, type BoardTool } from './board-toolbar.js';
import { GraphViewport } from './graph-viewport.js';
import { InlineInput } from './inline-input.js';
import './board.css';

export type BoardCanvasItem = {
  id: string;
  label: string;
  description?: string;
  count?: number;
  types?: CardType[];
  x?: number | null;
  y?: number | null;
  z?: number | null;
  kind?: 'text' | 'image';
  assetId?: string | null;
  imageWidth?: number | null;
  /** 本地上传占位。不请求图片地址 */
  uploading?: boolean;
};
export type BoardCanvasLink = { id: string; fromId: string; toId: string; label: string; count?: number };
export type BoardSpot = { id: string; x: number; y: number };

type Pt = { x: number; y: number };

type Editing =
  | { kind: 'create'; at: Pt }
  | { kind: 'rename'; id: string }
  | { kind: 'link'; fromId: string; toId: string }
  | { kind: 'relabel'; id: string }
  | null;

type DragGesture = {
  serial: number;
  pointerId: number;
  id: string;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  moved: boolean;
};

type ImageResize = {
  serial: number;
  pointerId: number;
  id: string;
  startWorldX: number;
  originWidth: number;
  width: number;
};

type LinkDrag = {
  fromId: string;
  lineFromId: string;
  cursor: Pt;
  mode: 'handle' | 'drag' | 'armed';
  pointerId?: number;
  startClientX?: number;
  startClientY?: number;
  moved: boolean;
  armedFromId?: string;
};

function readViewportCenter(g: SVGGElement | null): Pt | null {
  const svg = g?.ownerSVGElement;
  if (!g || !svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const matrix = g.getScreenCTM();
  if (!matrix) return null;
  try {
    const point = new DOMPoint(rect.left + rect.width / 2, rect.top + rect.height / 2).matrixTransform(matrix.inverse());
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { x: point.x, y: point.y };
  } catch {
    return null;
  }
}

function bounds(boxes: { x: number; y: number; w: number; h: number }[]) {
  if (boxes.length === 0) return { worldX: 0, worldY: 0, worldWidth: 520, worldHeight: 360 };
  const minX = Math.min(...boxes.map((box) => box.x)) - 48;
  const minY = Math.min(...boxes.map((box) => box.y)) - 48;
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + 96;
  const maxY = Math.max(...boxes.map((box) => box.y + box.h)) + 72;
  return {
    worldX: minX,
    worldY: minY,
    worldWidth: Math.max(520, maxX - minX),
    worldHeight: Math.max(360, maxY - minY),
  };
}

function isFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return true;
  }
  return target.closest('.tiptap, input, textarea, [contenteditable="true"]') !== null;
}

function transferHasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  return Array.from(data.types).includes('Files');
}

function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const listed = Array.from(data.files).filter((file) => isImageMime(file.type));
  if (listed.length > 0) return listed;
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !isImageMime(item.type)) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

function isImageMime(type: string): boolean {
  const mime = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime.startsWith('image/');
}

export function BoardCanvas(props: {
  items: BoardCanvasItem[];
  links: BoardCanvasLink[];
  selectedId: string | null;
  onSelectItem: (id: string) => void;
  onSelectLink: (id: string) => void;
  /** 双击节点打开（合集）。与 onRenameItem 二选一 */
  onOpenItem?: (id: string) => void;
  /** 双击节点内联改名 */
  onRenameItem?: (id: string, name: string) => void;
  /** 给了就只在进入时适应一次；不给则沿用点和边的 id 串 */
  fitKey?: string;
  /** 双击空白内联创建；placeholder 也是开关 */
  createPlaceholder?: string;
  onCreate?: (name: string, at: Pt) => void;
  /** 松手时写入左上角。返回 false 表示失败，点回到按下时的位置 */
  onMove?: (id: string, x: number, y: number, z: number) => boolean | Promise<boolean>;
  /** 松手时写入图片宽度。返回 false 或抛错时回到按下时的宽度 */
  onResizeImage?: (id: string, imageWidth: number) => boolean | Promise<boolean>;
  /** 已有部分坐标时，把还没有 x 的点放到当前视野中心 */
  onPlaceUnpositioned?: (spots: BoardSpot[]) => void;
  /** 从节点手柄拖到另一个节点连线 */
  onConnect?: (fromId: string, toId: string, label: string) => void;
  /** 悬停预览内容 */
  renderPeek?: (id: string) => ReactNode;
  onPeekItem?: (id: string | null) => void;
  /** Esc（方向键导航后取消选中） */
  onEscape?: () => void;
  /** 合集画布左侧工具。全貌不传 */
  enableTools?: boolean;
  /** 改边的标签。空字符串或与原来相同由调用方忽略 */
  onRelabel?: (id: string, label: string) => void;
  /** 选文件、粘贴或拖入后交给调用方。不传则只回到选择工具 */
  onInsertImages?: (files: File[], at: Pt, anchor: 'center' | 'corner') => void;
}) {
  const worldRef = useRef<SVGGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [tool, setTool] = useState<BoardTool>('select');
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekTimer = useRef(0);
  const dragRef = useRef<DragGesture | null>(null);
  const dragSerial = useRef(0);
  const [dragBox, setDragBox] = useState<{ id: string; x: number; y: number } | null>(null);
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({});
  const resizeRef = useRef<ImageResize | null>(null);
  const resizeSerial = useRef(0);
  const [resizePreview, setResizePreview] = useState<{ id: string; width: number } | null>(null);
  const onResizeRef = useRef(props.onResizeImage);
  const [spotCenter, setSpotCenter] = useState<{ key: string; x: number; y: number } | null>(null);
  const itemsRef = useRef(props.items);
  const linksRef = useRef(props.links);
  const onMoveRef = useRef(props.onMove);
  const onPlaceRef = useRef(props.onPlaceUnpositioned);
  const onInsertRef = useRef(props.onInsertImages);
  const editingRef = useRef<Editing>(null);
  const toolRef = useRef<BoardTool>('select');
  const linkDragRef = useRef<LinkDrag | null>(null);
  const textClickRef = useRef<{ pointerId: number; x: number; y: number; blocked: boolean } | null>(null);
  const blankRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const fittedWorld = useRef({ worldX: 0, worldY: 0, worldWidth: 1, worldHeight: 1 });
  itemsRef.current = props.items;
  linksRef.current = props.links;
  onMoveRef.current = props.onMove;
  onResizeRef.current = props.onResizeImage;
  onPlaceRef.current = props.onPlaceUnpositioned;
  onInsertRef.current = props.onInsertImages;
  editingRef.current = editing;
  toolRef.current = tool;
  linkDragRef.current = linkDrag;

  const toolsOn = props.enableTools === true;
  const selectTool = !toolsOn || tool === 'select';

  const hasSaved = props.items.some((item) => isFiniteNumber(item.x));
  const missingKey = props.items
    .filter((item) => !isFiniteNumber(item.x))
    .map((item) => item.id)
    .join(',');
  const spot = hasSaved && spotCenter?.key === missingKey ? { x: spotCenter.x, y: spotCenter.y } : null;
  const laid = hasSaved
    ? layoutPlaced(
        props.items.map((item) => ({ id: item.id, x: item.x ?? null, y: item.y ?? null })),
        props.links,
        spot ?? { x: 0, y: 0 },
      )
    : layoutBoard(props.items, props.links);
  const placedIds = new Set(props.items.filter((item) => isFiniteNumber(item.x)).map((item) => item.id));
  const visible = hasSaved && spot === null ? laid.filter((box) => placedIds.has(box.id)) : laid;
  const moved = dragBox
    ? visible.map((box) => (box.id === dragBox.id ? { ...box, x: dragBox.x, y: dragBox.y } : box))
    : visible;
  const itemById = new Map(props.items.map((item) => [item.id, item]));
  const imageHeights = new Map<string, number>();
  const boxes = moved.map((box) => {
    const item = itemById.get(box.id);
    if (item?.kind !== 'image') return box;
    const width = resizePreview?.id === item.id ? resizePreview.width : item.imageWidth;
    const stored = item.assetId ? imageRatios[item.assetId] : undefined;
    const ratio = stored !== undefined && stored > 0 && Number.isFinite(stored) ? stored : 1;
    const frame = imageFrame(width, ratio);
    imageHeights.set(item.id, frame.pictureH);
    return { ...box, w: frame.w, h: frame.h };
  });
  const boxOf = new Map(boxes.map((box) => [box.id, box]));
  const world = bounds(boxes);
  fittedWorld.current = world;
  const resetKey =
    props.fitKey ??
    `${props.items.map((item) => item.id).join(',')}|${props.links.map((link) => link.id).join(',')}`;
  const drawItems = hasSaved
    ? [...props.items].sort(
        (left, right) => (isFiniteNumber(left.z) ? left.z : 0) - (isFiniteNumber(right.z) ? right.z : 0),
      )
    : props.items;
  const paintItems = dragBox
    ? [...drawItems.filter((item) => item.id !== dragBox.id), ...drawItems.filter((item) => item.id === dragBox.id)]
    : drawItems;

  function toWorld(clientX: number, clientY: number): Pt {
    const g = worldRef.current;
    const m = g?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  function nodeIdAt(clientX: number, clientY: number): string {
    const hit = document.elementFromPoint(clientX, clientY);
    if (!(hit instanceof Element)) return '';
    return hit.closest('[data-node-id]')?.getAttribute('data-node-id') ?? '';
  }

  function publishLink(next: LinkDrag | null) {
    linkDragRef.current = next;
    setLinkDrag(next);
  }

  function finishEditing() {
    editingRef.current = null;
    setEditing(null);
  }

  function stopEditing() {
    finishEditing();
    if (props.enableTools) {
      toolRef.current = 'select';
      setTool('select');
    }
  }

  function chooseTool(next: BoardTool) {
    if (next !== 'connect') publishLink(null);
    toolRef.current = next;
    setTool(next);
  }

  function pickImages() {
    publishLink(null);
    fileRef.current?.click();
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const list = event.currentTarget.files;
    const files = list ? Array.from(list) : [];
    event.currentTarget.value = '';
    if (files.length === 0) return;
    toolRef.current = 'select';
    setTool('select');
    const at = readViewportCenter(worldRef.current);
    if (!at) return;
    props.onInsertImages?.(files, at, 'center');
  }

  function isUploading(id: string): boolean {
    return itemsRef.current.some((entry) => entry.id === id && entry.uploading === true);
  }

  function cancelForDrop() {
    if (dragRef.current) {
      dragRef.current = null;
      setDragBox(null);
    }
    if (linkDragRef.current) publishLink(null);
    if (editingRef.current) finishEditing();
  }

  function onCanvasDragOver(event: ReactDragEvent) {
    if (!toolsOn || !transferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
  }

  function onCanvasDrop(event: ReactDragEvent) {
    if (!toolsOn || isFieldTarget(event.target)) return;
    event.preventDefault();
    cancelForDrop();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    props.onInsertImages?.(files, toWorld(event.clientX, event.clientY), 'corner');
  }

  /* ---------- 悬停预览 ---------- */
  function armPeek(id: string) {
    if (!props.renderPeek || isUploading(id)) return;
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => {
      setPeekId(id);
      props.onPeekItem?.(id);
    }, 450);
  }

  function disarmPeek() {
    window.clearTimeout(peekTimer.current);
    if (peekId !== null) {
      setPeekId(null);
      props.onPeekItem?.(null);
    }
  }

  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  /* ---------- 键盘：工具快捷键、方向键、Enter、Esc ---------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isFieldTarget(event.target)) return;
      if (document.querySelector('.modal-wrap, .overlay, .ctx-menu')) return;

      if (event.key === 'Escape') {
        const busy =
          dragRef.current !== null ||
          resizeRef.current !== null ||
          linkDragRef.current !== null ||
          editingRef.current !== null;
        if (dragRef.current) {
          dragRef.current = null;
          setDragBox(null);
        }
        if (resizeRef.current) {
          resizeRef.current = null;
          setResizePreview(null);
        }
        if (linkDragRef.current) publishLink(null);
        if (editingRef.current) finishEditing();
        if (busy) {
          if (props.enableTools) {
            toolRef.current = 'select';
            setTool('select');
          }
          event.preventDefault();
          return;
        }
        if (props.enableTools && toolRef.current !== 'select') {
          toolRef.current = 'select';
          setTool('select');
          event.preventDefault();
          return;
        }
        props.onEscape?.();
        return;
      }

      if (props.enableTools && !event.isComposing && !event.repeat) {
        const key = event.key.toLowerCase();
        if (key === 'v' || key === 't' || key === 'i' || key === 'l') {
          event.preventDefault();
          if (key === 'v') chooseTool('select');
          else if (key === 't') chooseTool('text');
          else if (key === 'l') chooseTool('connect');
          else pickImages();
          return;
        }
      }

      if (editingRef.current || linkDragRef.current) return;

      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const dir = dirs[event.key];
      if (dir) {
        if (boxes.length === 0) return;
        event.preventDefault();
        disarmPeek();
        const current = props.selectedId ? boxOf.get(props.selectedId) : undefined;
        if (!current) {
          const first = props.items.find((item) => !item.uploading);
          if (first) props.onSelectItem(first.id);
          return;
        }
        const cx = current.x + current.w / 2;
        const cy = current.y + current.h / 2;
        let best: { id: string; score: number } | null = null;
        for (const box of boxes) {
          if (box.id === current.id || isUploading(box.id)) continue;
          const ox = box.x + box.w / 2 - cx;
          const oy = box.y + box.h / 2 - cy;
          const primary = dir[0] !== 0 ? ox * dir[0] : oy * dir[1];
          if (primary <= 4) continue;
          const cross = dir[0] !== 0 ? Math.abs(oy) : Math.abs(ox);
          const score = primary + cross * 2.5;
          if (!best || score < best.score) best = { id: box.id, score };
        }
        if (best) props.onSelectItem(best.id);
        return;
      }
      if (event.key === 'Enter') {
        const item = props.items.find((entry) => entry.id === props.selectedId);
        const link = props.links.find((entry) => entry.id === props.selectedId);
        if (item?.uploading) return;
        if (item) {
          event.preventDefault();
          disarmPeek();
          if (props.onOpenItem) props.onOpenItem(item.id);
          else if (props.onRenameItem) {
            const next: Editing = { kind: 'rename', id: item.id };
            editingRef.current = next;
            setEditing(next);
          }
          return;
        }
        if (link && props.onRelabel) {
          event.preventDefault();
          disarmPeek();
          const next: Editing = { kind: 'relabel', id: link.id };
          editingRef.current = next;
          setEditing(next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!toolsOn) return;
    const onPaste = (event: ClipboardEvent) => {
      if (isFieldTarget(event.target)) return;
      if (document.querySelector('.modal-wrap, .overlay, .ctx-menu')) return;
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      const at = readViewportCenter(worldRef.current);
      if (!at) return;
      event.preventDefault();
      onInsertRef.current?.(files, at, 'center');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [toolsOn]);

  /* ---------- 拖拽连线（手柄，或连线工具） ---------- */
  function beginLink(event: ReactPointerEvent, fromId: string) {
    if (!props.onConnect || isUploading(fromId)) return;
    event.stopPropagation();
    event.preventDefault();
    disarmPeek();
    publishLink({
      fromId,
      lineFromId: fromId,
      cursor: toWorld(event.clientX, event.clientY),
      mode: 'handle',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    });
  }

  useEffect(() => {
    if (!linkDrag) return;
    const onMove = (event: PointerEvent) => {
      const current = linkDragRef.current;
      if (!current) return;
      if (current.mode !== 'armed' && current.pointerId !== event.pointerId) return;
      const cursor = toWorld(event.clientX, event.clientY);
      if (current.mode === 'armed') {
        publishLink({ ...current, cursor });
        return;
      }
      let moved = current.moved;
      if (
        current.startClientX !== undefined &&
        current.startClientY !== undefined &&
        Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) > 4
      ) {
        moved = true;
      }
      const lineFromId = !moved && current.armedFromId ? current.armedFromId : current.fromId;
      publishLink({ ...current, cursor, moved, lineFromId });
    };
    const onUp = (event: PointerEvent) => {
      const current = linkDragRef.current;
      if (!current || current.mode === 'armed') return;
      if (current.pointerId !== event.pointerId) return;
      const moved =
        current.moved ||
        (current.startClientX !== undefined &&
          current.startClientY !== undefined &&
          Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) > 4);
      if (current.mode === 'handle' || moved) {
        const toId = nodeIdAt(event.clientX, event.clientY);
        publishLink(null);
        if (toId !== '' && toId !== current.fromId && !isUploading(toId) && !isUploading(current.fromId)) {
          const next: Editing = { kind: 'link', fromId: current.fromId, toId };
          editingRef.current = next;
          setEditing(next);
        }
        return;
      }
      const clickedId = current.fromId;
      if (current.armedFromId && current.armedFromId !== clickedId) {
        publishLink(null);
        if (isUploading(current.armedFromId) || isUploading(clickedId)) return;
        const next: Editing = { kind: 'link', fromId: current.armedFromId, toId: clickedId };
        editingRef.current = next;
        setEditing(next);
        return;
      }
      if (current.armedFromId) {
        publishLink(null);
        return;
      }
      const cursor = toWorld(event.clientX, event.clientY);
      publishLink({ fromId: clickedId, lineFromId: clickedId, cursor, mode: 'armed', moved: false });
    };
    const onCancel = (event: PointerEvent) => {
      const current = linkDragRef.current;
      if (!current || current.mode === 'armed' || current.pointerId !== event.pointerId) return;
      publishLink(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [linkDrag !== null]);

  /* ---------- 文字工具单击空白；连线工具点选 / 取消 ---------- */
  useEffect(() => {
    if (!toolsOn) return;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (toolRef.current === 'text') {
        if (!target.closest('.gvp')) return;
        if (target.closest('.node, .gvp-tools, .gvp-minimap, .binput, .ctx-menu')) return;
        textClickRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          blocked: editingRef.current !== null,
        };
        return;
      }
      if (toolRef.current !== 'connect' || !props.onConnect) return;
      const nodeId = target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? '';
      if (nodeId !== '') {
        if (isUploading(nodeId) || editingRef.current) return;
        const armed = linkDragRef.current?.mode === 'armed' ? linkDragRef.current : null;
        if (linkDragRef.current && linkDragRef.current.mode !== 'armed') return;
        event.preventDefault();
        publishLink({
          fromId: nodeId,
          lineFromId: armed?.fromId ?? nodeId,
          armedFromId: armed?.fromId,
          cursor: toWorld(event.clientX, event.clientY),
          mode: 'drag',
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          moved: false,
        });
        return;
      }
      if (linkDragRef.current?.mode !== 'armed') return;
      if (target.closest('.board-toolbar, .gvp-tools, .gvp-minimap, .binput, .ctx-menu')) return;
      blankRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      const text = textClickRef.current;
      if (text?.pointerId === event.pointerId) {
        textClickRef.current = null;
        const moved = Math.hypot(event.clientX - text.x, event.clientY - text.y) > 4;
        if (!moved && !text.blocked && toolRef.current === 'text' && !editingRef.current) {
          const next: Editing = { kind: 'create', at: toWorld(event.clientX, event.clientY) };
          editingRef.current = next;
          setEditing(next);
        }
      }
      const blank = blankRef.current;
      if (blank?.pointerId === event.pointerId) {
        blankRef.current = null;
        const moved = Math.hypot(event.clientX - blank.x, event.clientY - blank.y) > 4;
        if (!moved && linkDragRef.current?.mode === 'armed') publishLink(null);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [toolsOn, props.onConnect !== undefined]);

  /* ---------- 拖动节点：超过 4 个屏幕像素才算移动 ---------- */
  function beginDrag(event: ReactPointerEvent, nodeId: string) {
    if (onMoveRef.current === undefined || editingRef.current || linkDragRef.current || resizeRef.current) return;
    if (props.enableTools && toolRef.current !== 'select') return;
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.bnode-handle, .bnode-resize')) return;
    const box = boxOf.get(nodeId);
    if (!box) return;
    event.stopPropagation();
    const start = toWorld(event.clientX, event.clientY);
    dragRef.current = {
      serial: (dragSerial.current += 1),
      pointerId: event.pointerId,
      id: nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: start.x,
      startWorldY: start.y,
      originX: box.x,
      originY: box.y,
      x: box.x,
      y: box.y,
      moved: false,
    };
  }

  useEffect(() => {
    if (props.onMove === undefined) return;
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.moved) {
        const dist = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
        if (dist <= 4) return;
        drag.moved = true;
      }
      const now = toWorld(event.clientX, event.clientY);
      drag.x = drag.originX + (now.x - drag.startWorldX);
      drag.y = drag.originY + (now.y - drag.startWorldY);
      setDragBox({ id: drag.id, x: drag.x, y: drag.y });
      if (drag.id.startsWith('uploading:')) onMoveRef.current?.(drag.id, drag.x, drag.y, 0);
    };
    const finish = (event: PointerEvent, commit: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      const serial = drag.serial;
      if (!commit || !drag.moved) {
        if (dragSerial.current === serial) setDragBox(null);
        return;
      }
      const move = onMoveRef.current;
      if (!move) {
        if (dragSerial.current === serial) setDragBox(null);
        return;
      }
      const z = nextPlacementZ(itemsRef.current.map((item) => item.z));
      void (async () => {
        try {
          await move(drag.id, drag.x, drag.y, z);
        } catch {
          // 失败时下面清掉位移，点回到按下时的坐标
        }
        if (dragSerial.current !== serial) return;
        setDragBox(null);
      })();
    };
    const onPointerUp = (event: PointerEvent) => finish(event, true);
    const onPointerCancel = (event: PointerEvent) => finish(event, false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [props.onMove !== undefined]);

  /* ---------- 调整图片宽度：不改 x、y、z，失败回到按下时的宽度 ---------- */
  function rememberImageRatio(assetId: string, naturalWidth: number, naturalHeight: number) {
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    const ratio = naturalWidth / naturalHeight;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setImageRatios((current) => (current[assetId] === ratio ? current : { ...current, [assetId]: ratio }));
  }

  function beginResize(event: ReactPointerEvent, nodeId: string) {
    if (event.button !== 0) return;
    if (onResizeRef.current === undefined || editingRef.current || linkDragRef.current || dragRef.current) return;
    const box = boxOf.get(nodeId);
    const item = itemsRef.current.find((entry) => entry.id === nodeId);
    if (!box || item?.kind !== 'image' || item.uploading) return;
    event.stopPropagation();
    event.preventDefault();
    disarmPeek();
    const start = toWorld(event.clientX, event.clientY);
    resizeRef.current = {
      serial: (resizeSerial.current += 1),
      pointerId: event.pointerId,
      id: nodeId,
      startWorldX: start.x,
      originWidth: box.w,
      width: box.w,
    };
  }

  useEffect(() => {
    if (props.onResizeImage === undefined) return;
    const onPointerMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const now = toWorld(event.clientX, event.clientY);
      const dx = now.x - resize.startWorldX;
      if (!Number.isFinite(dx)) return;
      const width = imageFrame(resize.originWidth + dx, 1).w;
      if (width === resize.width) return;
      resize.width = width;
      setResizePreview({ id: resize.id, width });
    };
    const finish = (event: PointerEvent, commit: boolean) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      resizeRef.current = null;
      const serial = resize.serial;
      const width = resize.width;
      if (!commit || width === resize.originWidth) {
        if (resizeSerial.current === serial) setResizePreview(null);
        return;
      }
      const save = onResizeRef.current;
      if (!save) {
        if (resizeSerial.current === serial) setResizePreview(null);
        return;
      }
      void (async () => {
        let ok = false;
        try {
          ok = (await save(resize.id, width)) !== false;
        } catch {
          ok = false;
        }
        if (resizeSerial.current !== serial) return;
        if (!ok) setResizePreview(null);
      })();
    };
    const onPointerUp = (event: PointerEvent) => finish(event, true);
    const onPointerCancel = (event: PointerEvent) => finish(event, false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [props.onResizeImage !== undefined]);

  useEffect(() => {
    if (!resizePreview || resizeRef.current) return;
    const item = props.items.find((entry) => entry.id === resizePreview.id);
    if (item && item.imageWidth === resizePreview.width) setResizePreview(null);
  }, [props.items, resizePreview]);

  useEffect(() => {
    if (!hasSaved || missingKey === '') return;
    let cancelled = false;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      if (cancelled) return;
      frames += 1;
      const measured = readViewportCenter(worldRef.current);
      const current = fittedWorld.current;
      const midX = current.worldX + current.worldWidth / 2;
      const midY = current.worldY + current.worldHeight / 2;
      const fitted = measured !== null && Math.hypot(measured.x - midX, measured.y - midY) < 8;
      if (measured && (fitted || frames >= 45)) {
        setSpotCenter({ key: missingKey, x: measured.x, y: measured.y });
        return;
      }
      if (frames >= 90) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [hasSaved, missingKey]);

  useEffect(() => {
    if (!hasSaved || missingKey === '' || !spotCenter || spotCenter.key !== missingKey) return;
    const items = itemsRef.current;
    const laidNow = layoutPlaced(
      items.map((item) => ({ id: item.id, x: item.x ?? null, y: item.y ?? null })),
      linksRef.current,
      { x: spotCenter.x, y: spotCenter.y },
    );
    const missing = new Set(items.filter((item) => !isFiniteNumber(item.x)).map((item) => item.id));
    const spots = laidNow.filter((box) => missing.has(box.id)).map((box) => ({ id: box.id, x: box.x, y: box.y }));
    if (spots.length === 0) return;
    onPlaceRef.current?.(spots);
  }, [hasSaved, missingKey, spotCenter]);

  const peekBox = peekId ? boxOf.get(peekId) : undefined;
  const peekWidth = 240;
  const peekFlip = peekBox ? peekBox.x + peekBox.w + 12 + peekWidth > world.worldX + world.worldWidth : false;
  const canvasClass = !toolsOn ? undefined : tool === 'text' ? 'tool-text' : tool === 'connect' ? 'tool-connect' : undefined;

  return (
    <div className="board-intake" onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>
      <GraphViewport
        className={canvasClass}
        worldX={world.worldX}
        worldY={world.worldY}
        worldWidth={world.worldWidth}
        worldHeight={world.worldHeight}
        resetKey={resetKey}
        onBackgroundDoubleClick={
          props.onCreate && props.createPlaceholder
            ? (point) => {
                if (props.enableTools && tool !== 'select') return;
                disarmPeek();
                const next: Editing = { kind: 'create', at: { x: point.worldX, y: point.worldY } };
                editingRef.current = next;
                setEditing(next);
              }
            : undefined
        }
        minimap={
          <>
            {boxes.map((box) => (
              <rect
                key={box.id}
                className={props.selectedId === box.id ? 'mm-node focus' : 'mm-node'}
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                rx={6}
              />
            ))}
          </>
        }
      >
        <g ref={worldRef}>
          <defs>
            <pattern id="board-dots" width={26} height={26} patternUnits="userSpaceOnUse">
              <circle cx={1.2} cy={1.2} r={1.2} fill="rgba(0, 0, 0, 0.09)" />
            </pattern>
            <marker id="board-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="rgba(0, 0, 0, 0.3)" />
            </marker>
            <marker id="board-arrow-on" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
            </marker>
          </defs>
          <rect
            x={world.worldX - 600}
            y={world.worldY - 600}
            width={world.worldWidth + 1200}
            height={world.worldHeight + 1200}
            fill="url(#board-dots)"
            pointerEvents="none"
          />

          <BoardEdges
            links={props.links}
            boxOf={boxOf}
            selectedId={props.selectedId}
            editingId={editing?.kind === 'relabel' ? editing.id : null}
            onSelect={(id) => {
              disarmPeek();
              props.onSelectLink(id);
            }}
            onActivate={(id) => {
              disarmPeek();
              props.onSelectLink(id);
              if (!props.onRelabel) return;
              const next: Editing = { kind: 'relabel', id };
              editingRef.current = next;
              setEditing(next);
            }}
          />
          <BoardNodes
            items={paintItems}
            boxOf={boxOf}
            selectedId={props.selectedId}
            renamingId={editing?.kind === 'rename' ? editing.id : null}
            onSelect={(id) => {
              if (isUploading(id)) return;
              if (toolsOn && toolRef.current === 'connect') return;
              disarmPeek();
              props.onSelectItem(id);
            }}
            onActivate={(id) => {
              disarmPeek();
              if (isUploading(id)) return;
              if (toolsOn && toolRef.current === 'connect') return;
              if (props.onOpenItem) props.onOpenItem(id);
              else if (props.onRenameItem) {
                const next: Editing = { kind: 'rename', id };
                editingRef.current = next;
                setEditing(next);
              }
            }}
            onPointerEnter={armPeek}
            onPointerLeave={disarmPeek}
            onPointerDown={disarmPeek}
            onDragPointerDown={props.onMove && selectTool ? beginDrag : undefined}
            onBeginLink={props.onConnect && selectTool ? beginLink : undefined}
            imageHeights={imageHeights}
            onImageLoad={rememberImageRatio}
            onBeginResizeImage={props.onResizeImage ? beginResize : undefined}
          />

          {linkDrag
            ? (() => {
                const from = boxOf.get(linkDrag.lineFromId);
                if (!from) return null;
                const start = anchorOnBorder(from, linkDrag.cursor);
                return (
                  <g pointerEvents="none">
                    <line className="blink-temp" x1={start.x} y1={start.y} x2={linkDrag.cursor.x} y2={linkDrag.cursor.y} />
                    <circle className="blink-temp-dot" cx={linkDrag.cursor.x} cy={linkDrag.cursor.y} r={3.5} />
                  </g>
                );
              })()
            : null}

          {peekBox && props.renderPeek ? (
            <foreignObject
              className="bpeek"
              x={peekFlip ? peekBox.x - 12 - peekWidth : peekBox.x + peekBox.w + 12}
              y={peekBox.y + peekBox.h / 2 - 56}
              width={peekWidth}
              height={140}
            >
              {props.renderPeek(peekBox.id)}
            </foreignObject>
          ) : null}

          {editing?.kind === 'create' ? (
            <InlineInput
              x={editing.at.x - 84}
              y={editing.at.y - 17}
              w={168}
              h={34}
              placeholder={props.createPlaceholder ?? ''}
              onCommit={(name) => {
                const at = editing.at;
                finishEditing();
                props.onCreate?.(name, at);
              }}
              onCancel={stopEditing}
            />
          ) : null}
          {editing?.kind === 'rename'
            ? (() => {
                const box = boxOf.get(editing.id);
                const item = props.items.find((entry) => entry.id === editing.id);
                if (!box || !item) return null;
                return (
                  <InlineInput
                    x={box.x - 2}
                    y={box.y + box.h / 2 - 17}
                    w={box.w + 4}
                    h={34}
                    initial={item.label}
                    placeholder={item.label}
                    onCommit={(name) => {
                      finishEditing();
                      if (name !== item.label) props.onRenameItem?.(item.id, name);
                    }}
                    onCancel={stopEditing}
                  />
                );
              })()
            : null}
          {editing?.kind === 'link'
            ? (() => {
                const from = boxOf.get(editing.fromId);
                const to = boxOf.get(editing.toId);
                if (!from || !to) return null;
                const mid = edgeMidpoint(edgeGeometry(from, to, 0, 1, false));
                return (
                  <InlineInput
                    x={mid.x - 84}
                    y={mid.y - 17}
                    w={168}
                    h={34}
                    placeholder="关系，例如：前提"
                    onCommit={(label) => {
                      const draft = editing;
                      finishEditing();
                      props.onConnect?.(draft.fromId, draft.toId, label);
                    }}
                    onCancel={stopEditing}
                  />
                );
              })()
            : null}
          {editing?.kind === 'relabel'
            ? (() => {
                const link = props.links.find((entry) => entry.id === editing.id);
                if (!link) return null;
                const from = boxOf.get(link.fromId);
                const to = boxOf.get(link.toId);
                if (!from || !to) return null;
                const lane = edgeLanes(props.links).get(link.id) ?? { index: 0, count: 1, paired: false };
                const mid = edgeMidpoint(edgeGeometry(from, to, lane.index, lane.count, lane.paired));
                return (
                  <InlineInput
                    x={mid.x - 84}
                    y={mid.y - 17}
                    w={168}
                    h={34}
                    initial={link.label}
                    placeholder="关系，例如：前提"
                    onCommit={(label) => {
                      finishEditing();
                      if (label !== link.label) props.onRelabel?.(link.id, label);
                    }}
                    onCancel={stopEditing}
                  />
                );
              })()
            : null}
        </g>
      </GraphViewport>
      {toolsOn ? <BoardToolbar tool={tool} onTool={chooseTool} onImage={pickImages} /> : null}
      {toolsOn ? (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFiles}
        />
      ) : null}
    </div>
  );
}
