import type { CanvasPrefs, CardType, EdgeAppearance, LayoutDirection } from '@unfold/dto';
import { defaultCanvasPrefs, defaultEdgeAppearance } from '@unfold/dto';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { UMenuEntry } from '../../shared/ui/context-menu/context-menu.js';
import { BoardEdges } from './board-edges.js';
import { BranchLines } from './branch-lines.js';
import { branchLinkIds, branchRelationPoint } from './branch-geometry.js';
import { branchLevelExtra } from './label.js';
import { anchorOnBorder, edgeDraw, edgeLanes } from './edge-geometry.js';
import { EDGE_STROKE, EDGE_WIDTH } from './edge-style.js';
import { applyMarquee, applyPick, moveDelta, nodesInRect, normalizeRect, pickModeFromKeys, stackOrder } from './selection.js';
import { snapPoint, snapTextOrigin } from './snap.js';
import { isFiniteNumber, layoutBoard, layoutPlaced, nextPlacementZ, NODE_H, NODE_W, textNodeHeight } from './board-layout.js';
import {
  MINDMAP_DRAFT_H,
  mindmapDraftAt,
  mindmapKeyAction,
  mindmapNeighbor,
  mindmapSelectionOf,
} from './mindmap-draft.js';
import type { MindmapDraftRole, MindmapKeyAction } from './mindmap-draft.js';
import { MINDMAP_GROW_ID, previewMindmapGrow } from './mindmap-preview.js';
import { shortLabel } from './label.js';
import { mindmapDragRole, mindmapDropKind, mindmapFollowerIds, resolveMindmapDrop } from './mindmap-drag.js';
import type { MindmapDropBox, MindmapDropNode, MindmapSeamLine } from './mindmap-drag.js';
import { LinkComposer } from './link-composer.js';
import { imageFrame, IMAGE_NAME_LINE } from './image-frame.js';
import { BoardNodes, NodeChrome } from './board-nodes.js';
import { InclusionFrames, type InclusionFrameView } from './inclusion-frame.js';
import {
  inclusionChildId,
  inclusionFrameRect,
  inclusionItemId,
  type InclusionGroup,
} from './inclusion-view.js';
import { boardMenu, inclusionMenu, type BoardMenuAction } from './board-menu.js';
import { BoardToolbar, type BoardTool } from './board-toolbar.js';
import { GraphViewport, type ViewportMenuHit } from './graph-viewport.js';
import { InlineInput } from './inline-input.js';
import { peekPlacement } from './peek-placement.js';
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
  /** 收起后的子集合。不是点，不能连线、改名或生长 */
  face?: 'inclusion';
  /** 这个点画在哪个子集合里。坐标已经是父画布上的世界坐标 */
  groupId?: string;
  /** 大纲父级。只给合集画板画分支，不是边 */
  parentId?: string | null;
  outlineOrder?: number;
  /** 根的直接子项在两侧时的列。null 画在右。 */
  layoutSide?: 'left' | 'right' | null;
  /** 直接成员的折叠按钮。投影点和子集合芯片不设。 */
  fold?: { side: 'left' | 'right'; collapsed: boolean; count: number };
};
export type BoardCanvasLink = { id: string; fromId: string; toId: string; label: string; count?: number };
export type BoardSpot = { id: string; x: number; y: number };

type Pt = { x: number; y: number };

type Editing =
  | { kind: 'create'; at: Pt; groupId: string | null }
  | { kind: 'rename'; id: string }
  | { kind: 'link'; fromId: string; toId: string }
  | { kind: 'relabel'; id: string }
  | {
      kind: 'grow';
      role: MindmapDraftRole;
      nodeId: string;
      x: number;
      y: number;
      groupId: string | null;
      name: string;
      attempt: number;
    }
  | null;

type FrameShift = { childId: string; dx: number; dy: number; anchorX: number; anchorY: number };

/** 行内输入框高 34。输入文字垂直居中且略低于几何中心，向上提 INLINE_DY 与节点名字的基线排版对齐。 */
const INLINE_H = 34;
const INLINE_DY = 20;

type FrameDrag = {
  serial: number;
  pointerId: number;
  childId: string;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  originX: number;
  originY: number;
  anchorX: number;
  anchorY: number;
  dx: number;
  dy: number;
  moved: boolean;
};

type DragMember = { id: string; originX: number; originY: number };

type DragGesture = {
  serial: number;
  pointerId: number;
  anchorId: string;
  members: DragMember[];
  /** places 只写坐标。reparent 是单个直接成员，松手才改父级。 */
  mode: 'places' | 'reparent';
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  dx: number;
  dy: number;
  moved: boolean;
};

type MarqueeGesture = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
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
  return target.closest('.tiptap, input, textarea, [contenteditable="true"], .usel') !== null;
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

/** 预览让开右侧检查器和左侧工具栏，避免浮层钻到它们下面。 */
function visibleCanvas(host: DOMRect): { left: number; top: number; width: number; height: number } {
  let left = host.left;
  let right = host.right;
  const panel = document.querySelector('.board-panel');
  if (panel instanceof HTMLElement) {
    const rect = panel.getBoundingClientRect();
    if (rect.width > 0 && rect.left < right) right = Math.min(right, rect.left - 8);
  }
  const bar = document.querySelector('.board-toolbar');
  if (bar instanceof HTMLElement) {
    const rect = bar.getBoundingClientRect();
    if (rect.width > 0 && rect.right > left) left = Math.max(left, rect.right + 8);
  }
  return { left, top: host.top, width: Math.max(0, right - left), height: host.height };
}

function isImageMime(type: string): boolean {
  const mime = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime.startsWith('image/');
}

function canvasDropNode(item: BoardCanvasItem): MindmapDropNode {
  return {
    id: item.id,
    parentId: item.parentId ?? null,
    order: item.outlineOrder ?? 0,
    kind: mindmapDropKind(item),
  };
}

function boxesAt(
  boxes: readonly { id: string; x: number; y: number; w: number; h: number }[],
  shifted: ReadonlyMap<string, { x: number; y: number }>,
  zOf: ReadonlyMap<string, number>,
): MindmapDropBox[] {
  return boxes.map((box) => {
    const at = shifted.get(box.id);
    return {
      id: box.id,
      x: at?.x ?? box.x,
      y: at?.y ?? box.y,
      w: box.w,
      h: box.h,
      z: zOf.get(box.id) ?? 0,
    };
  });
}

export function BoardCanvas(props: {
  items: BoardCanvasItem[];
  links: BoardCanvasLink[];
  selectedId: string | null;
  /** 合集画布上同时选中的点。和 onSelectIds 一起用 */
  selectedIds?: readonly string[];
  onSelectIds?: (ids: string[]) => void;
  onSelectItem: (id: string) => void;
  onSelectLink: (id: string) => void;
  /** 再点一次已选中的点，或右键「查看详情」。不给则单击只选中 */
  onInspectItem?: (id: string) => void;
  /** 再点一次已选中的边，或右键「查看详情」 */
  onInspectLink?: (id: string) => void;
  /** 双击节点打开（合集）。与 onRenameItem 二选一 */
  onOpenItem?: (id: string) => void;
  /** 双击节点内联改名 */
  onRenameItem?: (id: string, name: string) => void;
  /** 给了就只在进入时适应一次；不给则沿用点和边的 id 串 */
  fitKey?: string;
  /** 双击空白内联创建；placeholder 也是开关 */
  createPlaceholder?: string;
  onCreate?: (name: string, at: Pt, groupId: string | null) => void;
  /** 松手时写入左上角。返回 false 表示失败，点回到按下时的位置 */
  onMove?: (id: string, x: number, y: number, z: number) => boolean | Promise<boolean>;
  /** 一次写下多个点。同一个合集应合成一次请求 */
  onMoveItems?: (items: { id: string; x: number; y: number; z: number }[]) => boolean | Promise<boolean>;
  /** 单个直接成员松手后改父级。anchor 为空不写坐标。返回 false 时坐标也不写。 */
  onMindmapDrop?: (input: {
    nodeId: string;
    items: { nodeId: string; parentId: string | null; order: number }[];
    anchor: { x: number; y: number; z: number } | null;
  }) => boolean | Promise<boolean>;
  /** 松手时写入图片宽度。返回 false 或抛错时回到按下时的宽度 */
  onResizeImage?: (id: string, imageWidth: number) => boolean | Promise<boolean>;
  /** 已有部分坐标时，把还没有 x 的点放到当前视野中心 */
  onPlaceUnpositioned?: (spots: BoardSpot[]) => void;
  /** 合集直接成员的坐标已经按脑图算好。这些点不进自动排布，也不补到视野中心。全貌不传。 */
  mindmap?: boolean;
  /** 从节点手柄拖到另一个节点连线 */
  onConnect?: (fromId: string, toId: string, label: string) => void;
  /** 悬停预览内容 */
  renderPeek?: (id: string) => ReactNode;
  onPeekItem?: (id: string | null) => void;
  /** Esc（方向键导航后取消选中） */
  onEscape?: () => void;
  /** 合集画布左侧工具。全貌不传 */
  enableTools?: boolean;
  /** 这个合集的连线外观。全貌用默认细灰实线 */
  appearance?: EdgeAppearance;
  /** 账号上的画布看法。不传则用默认 */
  canvas?: CanvasPrefs;
  onAppearance?: (next: EdgeAppearance) => void;
  onCanvas?: (patch: Partial<CanvasPrefs>) => void;
  /** 这个合集的脑图朝向。全貌不传 */
  layoutDirection?: LayoutDirection;
  onLayoutDirection?: (direction: LayoutDirection) => void;
  /** 把根的直接子项放到另一侧 */
  onFlipSide?: (id: string) => void;
  /** 改边的标签。空字符串或与原来相同由调用方忽略 */
  onRelabel?: (id: string, label: string) => void;
  /** 选中直接成员后写名字再建子主题、同级或父主题。失败时调用方返回 false，浮层留着。不连边。 */
  onGrowNode?: (draft: {
    name: string;
    x: number;
    y: number;
    groupId: string | null;
    role: MindmapDraftRole;
    nodeId: string;
  }) => void | boolean | Promise<void | boolean>;
  /** 同级上移或下移。到头由调用方决定不发请求。 */
  onMoveSibling?: (nodeId: string, direction: 'up' | 'down') => void;
  /** 选文件、粘贴或拖入后交给调用方。不传则只回到选择工具 */
  onInsertImages?: (files: File[], at: Pt, anchor: 'center' | 'corner', groupId: string | null) => void;
  /** 当前合集里展开或收起的子集合。用来画边框、拖动整块区域 */
  groups?: InclusionGroup[];
  /** 拖动展开区域的标题。写入的是锚点，不改成员坐标 */
  onMoveInclusion?: (childId: string, x: number, y: number) => boolean | Promise<boolean>;
  onToggleInclusion?: (childId: string) => void;
  /** 折起或展开一个直接成员的子树。不写摆放。 */
  onToggleFold?: (id: string) => void;
  onRemoveInclusion?: (childId: string) => void;
  /** 工具栏或右键插入。坐标是边框左上角，已经按网格吸附 */
  onInsertInclusion?: (origin: Pt) => void;
  /** 右键「移出这个合集」。不删除点 */
  onRemoveItem?: (id: string) => void;
  /** 右键删除点或合集。只打开确认 */
  onAskRemoveItem?: (id: string) => void;
  /** 右键删除边。只打开确认 */
  onAskRemoveLink?: (id: string) => void;
}) {
  const worldRef = useRef<SVGGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageAtRef = useRef<Pt | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [holdGrow, setHoldGrow] = useState<{
    role: MindmapDraftRole;
    nodeId: string;
    name: string;
    known: readonly string[];
  } | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [tool, setTool] = useState<BoardTool>('select');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekTimer = useRef(0);
  const peekCloseTimer = useRef(0);
  const peekPopRef = useRef<HTMLDivElement>(null);
  const peekBoxRef = useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const applyPeekRef = useRef<() => boolean>(() => false);
  const dragRef = useRef<DragGesture | null>(null);
  const dragSerial = useRef(0);
  /* pointerdown 时该点是否已是唯一选中。拖动一按下就会先发布选中，click 时再查必然为真，
     「再点一次出详情」必须在按下时记录。 */
  const downSoleRef = useRef(false);
  const [dragPlaces, setDragPlaces] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [seam, setSeam] = useState<MindmapSeamLine | null>(null);
  const marqueeRef = useRef<MarqueeGesture | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const selectedIdsRef = useRef<readonly string[]>([]);
  const onSelectIdsRef = useRef(props.onSelectIds);
  const onMoveItemsRef = useRef(props.onMoveItems);
  const onMindmapDropRef = useRef(props.onMindmapDrop);
  const boxesRef = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  const spaceRef = useRef(false);
  const frameDragRef = useRef<FrameDrag | null>(null);
  const frameSerial = useRef(0);
  const [frameShift, setFrameShift] = useState<FrameShift | null>(null);
  const onMoveInclusionRef = useRef(props.onMoveInclusion);
  const framesRef = useRef<InclusionFrameView[]>([]);
  const groupAtRef = useRef<(at: Pt) => string | null>(() => null);
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
  const mindmapRef = useRef(props.mindmap === true);
  const onInsertRef = useRef(props.onInsertImages);
  const editingRef = useRef<Editing>(null);
  const toolRef = useRef<BoardTool>('select');
  const linkDragRef = useRef<LinkDrag | null>(null);
  const textClickRef = useRef<{ pointerId: number; x: number; y: number; blocked: boolean } | null>(null);
  const blankRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const clickTimerRef = useRef(0);
  const clickActionRef = useRef<(() => void) | null>(null);
  const dragEndAtRef = useRef(0);
  const fittedWorld = useRef({ worldX: 0, worldY: 0, worldWidth: 1, worldHeight: 1 });
  itemsRef.current = props.items;
  linksRef.current = props.links;
  onMoveRef.current = props.onMove;
  onMoveItemsRef.current = props.onMoveItems;
  onMindmapDropRef.current = props.onMindmapDrop;
  onSelectIdsRef.current = props.onSelectIds;
  selectedIdsRef.current = props.selectedIds ?? [];
  onResizeRef.current = props.onResizeImage;
  onPlaceRef.current = props.onPlaceUnpositioned;
  mindmapRef.current = props.mindmap === true;
  onInsertRef.current = props.onInsertImages;
  onMoveInclusionRef.current = props.onMoveInclusion;
  editingRef.current = editing;
  toolRef.current = tool;
  linkDragRef.current = linkDrag;

  const toolsOn = props.enableTools === true;
  const multiOn = toolsOn && props.onSelectIds !== undefined;
  const selectTool = !toolsOn || tool === 'select';
  const appearance = props.appearance ?? defaultEdgeAppearance;
  const canvas = props.canvas ?? defaultCanvasPrefs;
  const route = toolsOn ? canvas.route : 'straight';
  const snapRef = useRef(false);
  snapRef.current = toolsOn && canvas.snap;

  const groups = props.groups ?? [];
  const mindmapOn = props.mindmap === true;
  const autoItems = mindmapOn
    ? props.items.filter((item) => mindmapDropKind(item) !== 'member')
    : props.items;
  const hasSaved = autoItems.some((item) => isFiniteNumber(item.x));
  const missingKey = autoItems
    .filter((item) => !isFiniteNumber(item.x))
    .map((item) => item.id)
    .join(',');
  const spot = hasSaved && spotCenter?.key === missingKey ? { x: spotCenter.x, y: spotCenter.y } : null;
  const laidAuto = hasSaved
    ? layoutPlaced(
        autoItems.map((item) => ({ id: item.id, x: item.x ?? null, y: item.y ?? null })),
        props.links,
        spot ?? { x: 0, y: 0 },
      )
    : layoutBoard(autoItems, props.links);
  const memberLaid = mindmapOn
    ? props.items.flatMap((item) => {
        if (mindmapDropKind(item) !== 'member') return [];
        if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) return [];
        return [{ id: item.id, x: item.x, y: item.y, w: NODE_W, h: NODE_H }];
      })
    : [];
  const laid = memberLaid.length === 0 ? laidAuto : [...laidAuto, ...memberLaid];
  const placedIds = new Set(props.items.filter((item) => isFiniteNumber(item.x)).map((item) => item.id));
  const visible = hasSaved && spot === null ? laid.filter((box) => placedIds.has(box.id)) : laid;
  const moved = dragPlaces
    ? visible.map((box) => {
        const at = dragPlaces[box.id];
        return at ? { ...box, x: at.x, y: at.y } : box;
      })
    : visible;
  const itemById = new Map(props.items.map((item) => [item.id, item]));
  const holdLanded =
    holdGrow !== null &&
    props.items.some((item) => !holdGrow.known.includes(item.id) && mindmapDropKind(item) === 'member');
  const growLive = editing?.kind === 'grow' ? editing : null;
  const grow =
    growLive !== null
      ? { role: growLive.role, nodeId: growLive.nodeId, name: growLive.name, typing: true as const }
      : holdGrow !== null && !holdLanded
        ? { role: holdGrow.role, nodeId: holdGrow.nodeId, name: holdGrow.name, typing: false as const }
        : null;
  const growPreview =
    mindmapOn && grow !== null && !dragPlaces
      ? previewMindmapGrow({
          members: props.items.flatMap((item) => {
            if (mindmapDropKind(item) !== 'member') return [];
            if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) return [];
            const slot = item.kind === 'image' ? imageFrame(item.imageWidth, 1) : null;
            return [
              {
                id: item.id,
                parentId: item.parentId ?? null,
                order: item.outlineOrder ?? 0,
                side: item.layoutSide ?? null,
                x: item.x,
                y: item.y,
                w: slot ? slot.w : NODE_W,
                h: slot ? slot.h : textNodeHeight(item.description),
              },
            ];
          }),
          folded: new Set(props.items.filter((item) => item.fold?.collapsed).map((item) => item.id)),
          direction: props.layoutDirection ?? 'right',
          role: grow.role,
          nodeId: grow.nodeId,
          draft: { w: NODE_W, h: NODE_H },
          levelExtra: branchLevelExtra(
            props.items.flatMap((item) => {
              if (item.groupId || item.face === 'inclusion') return [];
              return [{ id: item.id, parentId: item.parentId ?? null }];
            }),
            props.links,
          ),
        })
      : null;
  const previewAt = growPreview ? new Map(growPreview.boxes.map((box) => [box.id, box])) : null;
  const imageHeights = new Map<string, number>();
  const boxes = moved.map((box) => {
    const item = itemById.get(box.id);
    const shift =
      frameShift &&
      item?.groupId === frameShift.childId &&
      groups.some(
        (group) =>
          group.childId === frameShift.childId &&
          group.anchorX === frameShift.anchorX &&
          group.anchorY === frameShift.anchorY,
      )
        ? frameShift
        : null;
    const at = shift ? { ...box, x: box.x + shift.dx, y: box.y + shift.dy } : box;
    const preview = previewAt?.get(box.id);
    const placed = preview ? { ...at, x: preview.x, y: preview.y } : at;
    if (item?.kind !== 'image') return { ...placed, h: textNodeHeight(item?.description) };
    const width = resizePreview?.id === item.id ? resizePreview.width : item.imageWidth;
    const stored = item.assetId ? imageRatios[item.assetId] : undefined;
    const ratio = stored !== undefined && stored > 0 && Number.isFinite(stored) ? stored : 1;
    const slot = imageFrame(width, 1);
    const frame = imageFrame(width, ratio);
    imageHeights.set(item.id, frame.pictureH);
    return { ...placed, y: placed.y + (slot.h - frame.h) / 2, w: frame.w, h: frame.h };
  });
  const draftBox = previewAt?.get(MINDMAP_GROW_ID) ?? null;
  const boxOf = new Map(boxes.map((box) => [box.id, box]));
  if (draftBox) boxOf.set(MINDMAP_GROW_ID, draftBox);
  const branchItems =
    growPreview === null
      ? props.items
      : [
          ...props.items.map((item) =>
            item.id === growPreview.reparentId ? { ...item, parentId: MINDMAP_GROW_ID } : item,
          ),
          { id: MINDMAP_GROW_ID, parentId: growPreview.parentId },
        ];
  function composerPoint(
    fromId: string,
    toId: string,
    from: { x: number; y: number; w: number; h: number },
    to: { x: number; y: number; w: number; h: number },
    laneIndex = 0,
    laneCount = 1,
    paired = false,
  ) {
    return (
      branchRelationPoint(branchItems, boxOf, fromId, toId) ??
      edgeDraw(from, to, laneIndex, laneCount, paired, route).label
    );
  }
  boxesRef.current = boxes;
  const frames: InclusionFrameView[] = [];
  for (const group of groups) {
    if (group.collapsed) continue;
    const live =
      frameShift &&
      frameShift.childId === group.childId &&
      frameShift.anchorX === group.anchorX &&
      frameShift.anchorY === group.anchorY
        ? frameShift
        : null;
    const rect = inclusionFrameRect(group, boxOf, live);
    if (!rect) continue;
    frames.push({
      childId: group.childId,
      title: group.title,
      labels: group.labels,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      anchorX: group.anchorX,
      anchorY: group.anchorY,
    });
  }
  framesRef.current = frames;
  const world = bounds([...boxes, ...frames, ...(draftBox ? [draftBox] : [])]);
  fittedWorld.current = world;
  const resetKey =
    props.fitKey ??
    `${props.items.map((item) => item.id).join(',')}|${props.links.map((link) => link.id).join(',')}`;
  const drawItems = hasSaved
    ? [...props.items].sort(
        (left, right) => (isFiniteNumber(left.z) ? left.z : 0) - (isFiniteNumber(right.z) ? right.z : 0),
      )
    : props.items;
  const paintItems = dragPlaces
    ? [
        ...drawItems.filter((item) => dragPlaces[item.id] === undefined),
        ...drawItems.filter((item) => dragPlaces[item.id] !== undefined),
      ]
    : drawItems;

  function toWorld(clientX: number, clientY: number): Pt {
    const g = worldRef.current;
    const m = g?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  function groupAt(at: Pt): string | null {
    const list = framesRef.current;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const frame = list[index];
      if (!frame) continue;
      if (at.x >= frame.x && at.x <= frame.x + frame.w && at.y >= frame.y && at.y <= frame.y + frame.h) {
        return frame.childId;
      }
    }
    return null;
  }

  groupAtRef.current = groupAt;

  function isLinkable(id: string): boolean {
    if (id === '' || inclusionChildId(id) !== null || id.startsWith('uploading:')) return false;
    return itemsRef.current.find((entry) => entry.id === id)?.face !== 'inclusion';
  }

  function askInsert(origin: Pt) {
    props.onInsertInclusion?.(snapPoint(origin, snapRef.current));
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

  function pickImages(at?: Pt) {
    publishLink(null);
    imageAtRef.current = at ?? null;
    fileRef.current?.click();
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const list = event.currentTarget.files;
    const files = list ? Array.from(list) : [];
    const at = imageAtRef.current;
    imageAtRef.current = null;
    event.currentTarget.value = '';
    if (files.length === 0) return;
    toolRef.current = 'select';
    setTool('select');
    if (at) {
      props.onInsertImages?.(files, at, 'corner', groupAt(at));
      return;
    }
    const center = readViewportCenter(worldRef.current);
    if (!center) return;
    props.onInsertImages?.(files, center, 'center', groupAt(center));
  }

  function isUploading(id: string): boolean {
    return itemsRef.current.some((entry) => entry.id === id && entry.uploading === true);
  }

  function cancelForDrop() {
    if (dragRef.current || marqueeRef.current) releaseDragChrome();
    if (dragRef.current) {
      dragRef.current = null;
      setDragPlaces(null);
      setSeam(null);
    }
    if (marqueeRef.current) {
      marqueeRef.current = null;
      setMarqueeRect(null);
    }
    if (frameDragRef.current) {
      frameDragRef.current = null;
      setFrameShift(null);
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
    const at = toWorld(event.clientX, event.clientY);
    props.onInsertImages?.(files, at, 'corner', groupAt(at));
  }

  /* ---------- 悬停预览 ---------- */
  function gestureBlocksPeek(): boolean {
    return (
      dragRef.current !== null ||
      frameDragRef.current !== null ||
      resizeRef.current !== null ||
      linkDragRef.current !== null ||
      marqueeRef.current !== null
    );
  }

  function engageDragChrome() {
    document.documentElement.classList.add('board-dragging');
    window.getSelection()?.removeAllRanges();
  }

  function releaseDragChrome() {
    document.documentElement.classList.remove('board-dragging');
  }

  function armPeek(id: string) {
    if (!props.renderPeek || isUploading(id) || gestureBlocksPeek() || inclusionChildId(id) !== null) return;
    window.clearTimeout(peekTimer.current);
    if (peekId === id) {
      window.clearTimeout(peekCloseTimer.current);
      return;
    }
    window.clearTimeout(peekCloseTimer.current);
    if (peekId !== null) {
      setPeekId(null);
      props.onPeekItem?.(null);
    }
    peekTimer.current = window.setTimeout(() => {
      if (gestureBlocksPeek()) return;
      setPeekId(id);
      props.onPeekItem?.(id);
    }, 450);
  }

  /** 点和预览之间有空隙。晚一点关，指针还能移到预览上滚动。 */
  function scheduleClosePeek() {
    window.clearTimeout(peekTimer.current);
    window.clearTimeout(peekCloseTimer.current);
    peekCloseTimer.current = window.setTimeout(() => {
      setPeekId(null);
      props.onPeekItem?.(null);
    }, 280);
  }

  function holdPeek() {
    window.clearTimeout(peekCloseTimer.current);
  }

  function disarmPeek() {
    window.clearTimeout(peekTimer.current);
    window.clearTimeout(peekCloseTimer.current);
    if (peekId !== null) {
      setPeekId(null);
      props.onPeekItem?.(null);
    }
  }

  useEffect(
    () => () => {
      window.clearTimeout(peekTimer.current);
      window.clearTimeout(peekCloseTimer.current);
    },
    [],
  );

  /* ---------- 单击选中：拖动收尾的 click 吞掉，选中动作等一个双击窗口 ---------- */
  function cancelPendingClick() {
    if (clickTimerRef.current !== 0) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = 0;
    }
    clickActionRef.current = null;
  }

  /** click 紧跟 pointerup 到达；拖动刚结束的那一次不算单击 */
  function clickFollowsDrag(): boolean {
    return dragEndAtRef.current !== 0 && performance.now() - dragEndAtRef.current < 350;
  }

  function publishSelection(ids: string[]) {
    if (onSelectIdsRef.current) {
      onSelectIdsRef.current(ids);
      return;
    }
    const only = ids[0];
    if (only) props.onSelectItem(only);
    else props.onEscape?.();
  }

  function selectNode(id: string, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
    if (isUploading(id)) return;
    if (toolsOn && toolRef.current === 'connect') return;
    if (multiOn && (event.metaKey || event.ctrlKey || event.shiftKey)) {
      if (clickFollowsDrag()) return;
      publishSelection(applyPick(selectedIdsRef.current, id, pickModeFromKeys(event)));
      return;
    }
    selectOnSingleClick(() => {
      disarmPeek();
      const wasSole = downSoleRef.current;
      if (multiOn) publishSelection([id]);
      else props.onSelectItem(id);
      if (wasSole) props.onInspectItem?.(id);
    });
  }

  function selectOnSingleClick(select: () => void) {
    if (clickFollowsDrag()) return;
    cancelPendingClick();
    clickActionRef.current = select;
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = 0;
      const run = clickActionRef.current;
      clickActionRef.current = null;
      run?.();
    }, 250);
  }

  useEffect(
    () => () => {
      if (clickTimerRef.current !== 0) window.clearTimeout(clickTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!holdGrow) return;
    const landed = props.items.some(
      (item) => !holdGrow.known.includes(item.id) && mindmapDropKind(item) === 'member',
    );
    if (landed) setHoldGrow(null);
  }, [props.items, holdGrow]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.board-settings, .board-settings-btn')) return;
      setSettingsOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [settingsOpen]);

  function directMember(id: string): BoardCanvasItem | null {
    const item = itemsRef.current.find((entry) => entry.id === id) ?? null;
    if (
      mindmapSelectionOf({
        selectedIds: [id],
        selectedId: id,
        edge: false,
        item,
      }) !== 'member'
    ) {
      return null;
    }
    return item;
  }

  function rootDirectChild(id: string): boolean {
    const item = directMember(id);
    const parentId = item?.parentId ?? null;
    if (!item || parentId === null) return false;
    const parent = itemsRef.current.find((entry) => entry.id === parentId);
    if (!parent || (parent.parentId ?? null) !== null) return false;
    return directMember(parent.id) !== null;
  }

  function beginMindmap(role: MindmapDraftRole, nodeId: string) {
    const anchor = boxOf.get(nodeId);
    const source = directMember(nodeId);
    if (!anchor || !props.onGrowNode || !source) return;
    disarmPeek();
    const parent = role === 'parent' && source.parentId ? (boxOf.get(source.parentId) ?? null) : null;
    const at = mindmapDraftAt(role, anchor, { w: NODE_W, h: MINDMAP_DRAFT_H }, parent);
    const next: Editing = {
      kind: 'grow',
      role,
      nodeId,
      x: at.x,
      y: at.y,
      groupId: null,
      name: '',
      attempt: 0,
    };
    editingRef.current = next;
    setEditing(next);
  }

  function runMindmapKey(action: MindmapKeyAction) {
    const selectedId = props.selectedId;
    if (!selectedId || action.type === 'suppress') return;
    disarmPeek();
    if (action.type === 'rename') {
      startRename(selectedId);
      return;
    }
    if (action.type === 'move-sibling') {
      props.onMoveSibling?.(selectedId, action.direction);
      return;
    }
    if (action.type === 'navigate') {
      const outline = itemsRef.current.flatMap((item) => {
        if (directMember(item.id) === null) return [];
        return [{ id: item.id, parentId: item.parentId ?? null, outlineOrder: item.outlineOrder ?? 0 }];
      });
      const next = mindmapNeighbor(outline, selectedId, action.direction);
      if (next) publishSelection([next]);
      return;
    }
    beginMindmap(action.role, selectedId);
  }

  function beginCreate(at: Pt) {
    if (!props.onCreate || !props.createPlaceholder) return;
    disarmPeek();
    publishLink(null);
    if (props.enableTools) {
      toolRef.current = 'select';
      setTool('select');
    }
    const next: Editing = { kind: 'create', at: snapTextOrigin(at, snapRef.current), groupId: groupAt(at) };
    editingRef.current = next;
    setEditing(next);
  }

  function startRename(id: string) {
    if (!props.onRenameItem || isUploading(id) || inclusionChildId(id) !== null) return;
    disarmPeek();
    publishLink(null);
    const next: Editing = { kind: 'rename', id };
    editingRef.current = next;
    setEditing(next);
  }

  function startRelabel(id: string) {
    if (!props.onRelabel) return;
    disarmPeek();
    publishLink(null);
    const next: Editing = { kind: 'relabel', id };
    editingRef.current = next;
    setEditing(next);
  }

  function startConnect(id: string) {
    if (!props.onConnect || !isLinkable(id)) return;
    const box = boxOf.get(id);
    if (!box) return;
    disarmPeek();
    if (toolsOn) {
      toolRef.current = 'connect';
      setTool('connect');
    }
    publishLink({
      fromId: id,
      lineFromId: id,
      cursor: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
      mode: 'armed',
      moved: false,
    });
  }

  function inclusionCollapsed(id: string): boolean | null {
    if (inclusionChildId(id) === null) return null;
    if (props.items.some((entry) => entry.id === id && entry.face === 'inclusion')) return true;
    const childId = inclusionChildId(id);
    const group = groups.find((entry) => entry.childId === childId);
    if (group && !group.collapsed) return false;
    return null;
  }

  function runMenuAction(action: BoardMenuAction, hit: ViewportMenuHit) {
    if (action === 'inspect') {
      if (hit.kind === 'edge') props.onInspectLink?.(hit.id);
      else props.onInspectItem?.(hit.id);
      return;
    }
    if (action === 'insert-inclusion') {
      askInsert({ x: hit.worldX, y: hit.worldY });
      return;
    }
    if (action === 'toggle-inclusion') {
      const childId = inclusionChildId(hit.id);
      if (childId) props.onToggleInclusion?.(childId);
      return;
    }
    if (action === 'remove-inclusion') {
      const childId = inclusionChildId(hit.id);
      if (childId) props.onRemoveInclusion?.(childId);
      return;
    }
    if (action === 'create') beginCreate({ x: hit.worldX, y: hit.worldY });
    else if (action === 'image') pickImages({ x: hit.worldX, y: hit.worldY });
    else if (action === 'rename') startRename(hit.id);
    else if (action === 'open') props.onOpenItem?.(hit.id);
    else if (action === 'grow-child') beginMindmap('child', hit.id);
    else if (action === 'grow-sibling') beginMindmap('after', hit.id);
    else if (action === 'grow-before') beginMindmap('before', hit.id);
    else if (action === 'grow-parent') beginMindmap('parent', hit.id);
    else if (action === 'flip-side' && hit.kind === 'node') props.onFlipSide?.(hit.id);
    else if (action === 'connect') startConnect(hit.id);
    else if (action === 'remove') props.onRemoveItem?.(hit.id);
    else if (action === 'delete-item') props.onAskRemoveItem?.(hit.id);
    else if (action === 'relabel') startRelabel(hit.id);
    else props.onAskRemoveLink?.(hit.id);
  }

  function contextItems(hit: ViewportMenuHit): UMenuEntry[] {
    if (hit.kind === 'node' && isUploading(hit.id)) return [];
    disarmPeek();
    if (hit.kind === 'node' && !(props.onSelectIds && selectedIdsRef.current.includes(hit.id))) {
      publishSelection([hit.id]);
    }
    if (hit.kind === 'edge') props.onSelectLink(hit.id);
    const collapsed = hit.kind === 'node' ? inclusionCollapsed(hit.id) : null;
    const entries =
      collapsed === null
        ? boardMenu({
            kind: hit.kind,
            tools: toolsOn,
            canCreate: props.onCreate !== undefined && props.createPlaceholder !== undefined,
            canImage: toolsOn && props.onInsertImages !== undefined,
            canInspect: hit.kind === 'edge' ? props.onInspectLink !== undefined : props.onInspectItem !== undefined,
            canRename: props.onRenameItem !== undefined,
            canOpen: props.onOpenItem !== undefined,
            canGrow: props.onGrowNode !== undefined && hit.kind === 'node' && directMember(hit.id) !== null,
            canFlipSide:
              toolsOn &&
              props.layoutDirection === 'both' &&
              props.onFlipSide !== undefined &&
              hit.kind === 'node' &&
              rootDirectChild(hit.id),
            canConnect: toolsOn && props.onConnect !== undefined,
            canRemove: props.onRemoveItem !== undefined,
            canDeleteItem: props.onAskRemoveItem !== undefined,
            canRelabel: props.onRelabel !== undefined,
            canDeleteLink: props.onAskRemoveLink !== undefined,
            canInsert: toolsOn && props.onInsertInclusion !== undefined,
          })
        : inclusionMenu(collapsed);
    const items: UMenuEntry[] = [];
    for (const entry of entries) {
      if (entry.separator || entry.action === undefined) {
        items.push({ separator: true });
        continue;
      }
      const action = entry.action;
      items.push({
        label: entry.label,
        hint: entry.hint,
        danger: entry.danger,
        onSelect: () => runMenuAction(action, hit),
      });
    }
    return items;
  }

  /* ---------- 键盘：工具快捷键、方向键、Enter、Esc ---------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
        if (!multiOn || isFieldTarget(event.target)) return;
        if (document.querySelector('.modal-wrap, .overlay, .ctx-menu')) return;
        if (
          event.target instanceof Element &&
          event.target.closest('.panel, .collection-bar, .dock, .unassigned-pane, .outline-shell')
        ) {
          return;
        }
        event.preventDefault();
        onSelectIdsRef.current?.(boxesRef.current.map((box) => box.id));
        return;
      }
      const aside =
        event.target instanceof Element &&
        event.target.closest('.panel, .collection-bar, .dock, .unassigned-pane, .outline-shell') !== null;
      if (toolsOn && !aside) {
        const selectedId = props.selectedId;
        const action = mindmapKeyAction({
          toolsOn: true,
          field: isFieldTarget(event.target),
          blocked: document.querySelector('.modal-wrap, .overlay, .ctx-menu') !== null,
          composing: event.isComposing,
          repeat: event.repeat,
          key: event.key,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          selection: mindmapSelectionOf({
            selectedIds: props.selectedIds ?? [],
            selectedId,
            edge: selectedId !== null && linksRef.current.some((link) => link.id === selectedId),
            item: selectedId ? (itemsRef.current.find((entry) => entry.id === selectedId) ?? null) : null,
          }),
        });
        if (action) {
          event.preventDefault();
          if (action.type !== 'suppress' && !editingRef.current && !linkDragRef.current) runMindmapKey(action);
          return;
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isFieldTarget(event.target)) return;
      if (document.querySelector('.modal-wrap, .overlay, .ctx-menu')) return;
      // 点本身不能聚焦，焦点在 body 或画布上才建点。检查器和底栏里的 Tab / Enter 留给控件。
      if (
        event.target instanceof Element &&
        event.target.closest('.panel, .collection-bar, .dock, .unassigned-pane, .outline-shell')
      ) {
        return;
      }

      if (event.key === 'Escape') {
        if (settingsOpen) {
          event.preventDefault();
          setSettingsOpen(false);
          return;
        }
        const busy =
          dragRef.current !== null ||
          frameDragRef.current !== null ||
          resizeRef.current !== null ||
          linkDragRef.current !== null ||
          marqueeRef.current !== null ||
          editingRef.current !== null;
        if (dragRef.current) {
          dragRef.current = null;
          setDragPlaces(null);
          setSeam(null);
          releaseDragChrome();
        }
        if (marqueeRef.current) {
          marqueeRef.current = null;
          setMarqueeRect(null);
          releaseDragChrome();
        }
        if (frameDragRef.current) {
          frameDragRef.current = null;
          setFrameShift(null);
          releaseDragChrome();
        }
        if (resizeRef.current) {
          resizeRef.current = null;
          setResizePreview(null);
          releaseDragChrome();
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
        const navBoxes = [
          ...boxes,
          ...frames.map((frame) => ({
            id: inclusionItemId(frame.childId),
            x: frame.x,
            y: frame.y,
            w: frame.w,
            h: frame.h,
          })),
        ];
        if (navBoxes.length === 0) return;
        event.preventDefault();
        disarmPeek();
        const current = props.selectedId ? navBoxes.find((box) => box.id === props.selectedId) : undefined;
        if (!current) {
          const first = props.items.find((item) => !item.uploading);
          if (first) publishSelection([first.id]);
          return;
        }
        const cx = current.x + current.w / 2;
        const cy = current.y + current.h / 2;
        let best: { id: string; score: number } | null = null;
        for (const box of navBoxes) {
          if (box.id === current.id || isUploading(box.id)) continue;
          const ox = box.x + box.w / 2 - cx;
          const oy = box.y + box.h / 2 - cy;
          const primary = dir[0] !== 0 ? ox * dir[0] : oy * dir[1];
          if (primary <= 4) continue;
          const cross = dir[0] !== 0 ? Math.abs(oy) : Math.abs(ox);
          const score = primary + cross * 2.5;
          if (!best || score < best.score) best = { id: box.id, score };
        }
        if (best) publishSelection([best.id]);
        return;
      }
      const selectedChild = props.selectedId ? inclusionChildId(props.selectedId) : null;
      const inclusionSelected =
        selectedChild !== null &&
        (groups.some((group) => group.childId === selectedChild) ||
          props.items.some((entry) => entry.id === props.selectedId && entry.face === 'inclusion'));
      if (inclusionSelected && selectedChild) {
        if (event.key === 'Tab') {
          event.preventDefault();
          return;
        }
        if (event.key === 'Enter') {
          if (event.repeat) return;
          event.preventDefault();
          props.onToggleInclusion?.(selectedChild);
          return;
        }
      }
      if (event.key === 'Enter') {
        const item = props.items.find((entry) => entry.id === props.selectedId);
        const link = props.links.find((entry) => entry.id === props.selectedId);
        if (item?.uploading) return;
        if (item && !toolsOn) {
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
      onInsertRef.current?.(files, at, 'center', groupAtRef.current(at));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [toolsOn]);

  /* ---------- 拖拽连线（手柄，或连线工具） ---------- */
  function beginLink(event: ReactPointerEvent, fromId: string) {
    if (event.button !== 0 || !props.onConnect || !isLinkable(fromId)) return;
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
        if (isLinkable(toId) && isLinkable(current.fromId) && toId !== current.fromId) {
          const next: Editing = { kind: 'link', fromId: current.fromId, toId };
          editingRef.current = next;
          setEditing(next);
        }
        return;
      }
      const clickedId = current.fromId;
      if (current.armedFromId && current.armedFromId !== clickedId) {
        publishLink(null);
        if (!isLinkable(current.armedFromId) || !isLinkable(clickedId)) return;
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
        if (target.closest('.node, .gvp-tools, .gvp-minimap, .binput, .ctx-menu, .board-settings')) return;
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
        if (!isLinkable(nodeId) || editingRef.current) return;
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
      if (target.closest('.board-toolbar, .board-settings, .gvp-tools, .gvp-minimap, .binput, .ctx-menu')) return;
      blankRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      const text = textClickRef.current;
      if (text?.pointerId === event.pointerId) {
        textClickRef.current = null;
        const moved = Math.hypot(event.clientX - text.x, event.clientY - text.y) > 4;
        if (!moved && !text.blocked && toolRef.current === 'text' && !editingRef.current) {
          const world = toWorld(event.clientX, event.clientY);
          const next: Editing = {
            kind: 'create',
            at: snapTextOrigin(world, snapRef.current),
            groupId: groupAtRef.current(world),
          };
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

  useEffect(() => {
    if (!multiOn) return;
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      if (isFieldTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('button, select')) return;
      spaceRef.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spaceRef.current = false;
    };
    const blur = () => {
      spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      spaceRef.current = false;
    };
  }, [multiOn]);

  /* ---------- 拖动节点：超过 4 个屏幕像素才算移动。多选根只平移选中的点；单个直接成员带着子树 ---------- */
  function beginDrag(event: ReactPointerEvent, nodeId: string) {
    downSoleRef.current = multiOn
      ? selectedIdsRef.current.length === 1 && selectedIdsRef.current[0] === nodeId
      : props.selectedId === nodeId;
    if (spaceRef.current || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (
      onMoveRef.current === undefined ||
      editingRef.current ||
      linkDragRef.current ||
      resizeRef.current ||
      frameDragRef.current ||
      marqueeRef.current
    ) {
      return;
    }
    if (props.enableTools && toolRef.current !== 'select') return;
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.bnode-handle, .bnode-resize')) return;
    const box = boxOf.get(nodeId);
    if (!box) return;
    const current = selectedIdsRef.current;
    const ids = multiOn && current.includes(nodeId) ? current.filter((id) => boxOf.has(id)) : [nodeId];
    let mode: DragGesture['mode'] = 'places';
    let movingIds = ids;
    if (toolsOn) {
      const role = mindmapDragRole(ids, itemsRef.current);
      if (role === 'block') {
        event.stopPropagation();
        return;
      }
      if (role === 'reparent' && onMindmapDropRef.current) {
        mode = 'reparent';
        const outline = itemsRef.current.flatMap((item) =>
          mindmapDropKind(item) === 'member' ? [{ id: item.id, parentId: item.parentId ?? null }] : [],
        );
        movingIds = mindmapFollowerIds(nodeId, outline).filter((id) => boxOf.has(id));
      }
    }
    event.stopPropagation();
    disarmPeek();
    engageDragChrome();
    if (multiOn && !current.includes(nodeId)) publishSelection([nodeId]);
    const start = toWorld(event.clientX, event.clientY);
    const members = movingIds.flatMap((id) => {
      const at = boxOf.get(id);
      return at ? [{ id, originX: at.x, originY: at.y }] : [];
    });
    dragRef.current = {
      serial: (dragSerial.current += 1),
      pointerId: event.pointerId,
      anchorId: nodeId,
      members,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: start.x,
      startWorldY: start.y,
      dx: 0,
      dy: 0,
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
        window.getSelection()?.removeAllRanges();
      }
      const now = toWorld(event.clientX, event.clientY);
      const anchor = drag.members.find((member) => member.id === drag.anchorId) ?? drag.members[0];
      if (!anchor) return;
      const delta = moveDelta(
        { x: anchor.originX, y: anchor.originY },
        { x: drag.startWorldX, y: drag.startWorldY },
        now,
        snapRef.current,
      );
      drag.dx = delta.dx;
      drag.dy = delta.dy;
      const places: Record<string, { x: number; y: number }> = {};
      for (const member of drag.members) {
        const at = { x: member.originX + delta.dx, y: member.originY + delta.dy };
        places[member.id] = at;
        if (member.id.startsWith('uploading:')) onMoveRef.current?.(member.id, at.x, at.y, 0);
      }
      setDragPlaces(places);
      if (drag.mode === 'reparent') {
        const drop = readDrop(drag, now);
        setSeam(drop.type === 'anchor' ? null : drop.seam);
      }
      window.getSelection()?.removeAllRanges();
    };
    function readDrop(drag: DragGesture, pointer: Pt) {
      const shifted = new Map(
        drag.members.map((member) => [member.id, { x: member.originX + drag.dx, y: member.originY + drag.dy }]),
      );
      const zOf = new Map(itemsRef.current.map((item) => [item.id, isFiniteNumber(item.z) ? item.z : 0]));
      return resolveMindmapDrop({
        draggedId: drag.anchorId,
        pointer,
        nodes: itemsRef.current.map(canvasDropNode),
        boxes: boxesAt(boxesRef.current, shifted, zOf),
      });
    }
    const finish = (event: PointerEvent, commit: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      releaseDragChrome();
      if (drag.moved) dragEndAtRef.current = performance.now();
      const serial = drag.serial;
      const clearPlaces = () => {
        if (dragSerial.current !== serial) return;
        setDragPlaces(null);
        setSeam(null);
      };
      if (!commit || !drag.moved) {
        clearPlaces();
        return;
      }
      const commitPlaces = (payload: { id: string; x: number; y: number; z: number }[]) => {
        const moveItems = onMoveItemsRef.current;
        const moveOne = onMoveRef.current;
        void (async () => {
          try {
            if (moveItems) await moveItems(payload);
            else if (moveOne) {
              for (const item of payload) await moveOne(item.id, item.x, item.y, item.z);
            }
          } catch {
            // 失败时清掉位移，点回到按下时的坐标
          }
          clearPlaces();
        })();
      };
      if (drag.mode === 'reparent') {
        const drop = readDrop(drag, toWorld(event.clientX, event.clientY));
        if (dragSerial.current === serial) setSeam(null);
        if (drop.type === 'cancel') {
          clearPlaces();
          return;
        }
        const member = drag.members.find((item) => item.id === drag.anchorId);
        const spot = member
          ? {
              id: drag.anchorId,
              x: member.originX + drag.dx,
              y: member.originY + drag.dy,
              z: nextPlacementZ(itemsRef.current.map((item) => item.z)),
            }
          : null;
        if (drop.type === 'anchor') {
          if (!spot) clearPlaces();
          else commitPlaces([spot]);
          return;
        }
        const apply = onMindmapDropRef.current;
        if (!apply || (drop.anchor && !spot)) {
          clearPlaces();
          return;
        }
        if (!drop.anchor) clearPlaces();
        void (async () => {
          try {
            const ok = await apply({
              nodeId: drag.anchorId,
              items: drop.items,
              anchor: drop.anchor && spot ? { x: spot.x, y: spot.y, z: spot.z } : null,
            });
            if (ok === false) clearPlaces();
          } catch {
            clearPlaces();
          }
          clearPlaces();
        })();
        return;
      }
      const ordered = stackOrder(
        drag.members.map((member) => member.id),
        drag.anchorId,
      );
      const base = nextPlacementZ(itemsRef.current.map((item) => item.z));
      const payload = ordered.flatMap((id, index) => {
        const member = drag.members.find((item) => item.id === id);
        if (!member) return [];
        return [
          {
            id,
            x: member.originX + drag.dx,
            y: member.originY + drag.dy,
            z: id.startsWith('uploading:') ? 0 : base + index,
          },
        ];
      });
      commitPlaces(payload);
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
      releaseDragChrome();
    };
  }, [props.onMove !== undefined]);

  function beginMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !multiOn || !selectTool || spaceRef.current) return;
    if (editingRef.current || linkDragRef.current || resizeRef.current || frameDragRef.current || dragRef.current) return;
    const start = toWorld(event.clientX, event.clientY);
    marqueeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: start.x,
      startWorldY: start.y,
      moved: false,
    };
    disarmPeek();
    engageDragChrome();
  }

  useEffect(() => {
    if (!multiOn) return;
    const onPointerMove = (event: PointerEvent) => {
      const marquee = marqueeRef.current;
      if (!marquee || marquee.pointerId !== event.pointerId) return;
      if (!marquee.moved) {
        if (Math.hypot(event.clientX - marquee.startClientX, event.clientY - marquee.startClientY) <= 4) return;
        marquee.moved = true;
        window.getSelection()?.removeAllRanges();
      }
      const now = toWorld(event.clientX, event.clientY);
      setMarqueeRect(normalizeRect({ x: marquee.startWorldX, y: marquee.startWorldY }, now));
    };
    const finish = (event: PointerEvent) => {
      const marquee = marqueeRef.current;
      if (!marquee || marquee.pointerId !== event.pointerId) return;
      marqueeRef.current = null;
      setMarqueeRect(null);
      releaseDragChrome();
      const choose = onSelectIdsRef.current;
      if (!choose) return;
      if (!marquee.moved) {
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey) choose([]);
        return;
      }
      dragEndAtRef.current = performance.now();
      const now = toWorld(event.clientX, event.clientY);
      const rect = normalizeRect({ x: marquee.startWorldX, y: marquee.startWorldY }, now);
      const hits = nodesInRect(boxesRef.current, rect);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      choose(applyMarquee(selectedIdsRef.current, hits, additive));
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [multiOn]);

  /* ---------- 拖动展开的子集合：只改锚点，成员跟着边框走 ---------- */
  function beginFrameDrag(event: ReactPointerEvent, frame: InclusionFrameView) {
    const frameId = inclusionItemId(frame.childId);
    downSoleRef.current = multiOn
      ? selectedIdsRef.current.length === 1 && selectedIdsRef.current[0] === frameId
      : props.selectedId === frameId;
    if (onMoveInclusionRef.current === undefined || editingRef.current || linkDragRef.current || resizeRef.current) return;
    if (dragRef.current) return;
    if (props.enableTools && toolRef.current !== 'select') return;
    if (event.button !== 0 || spaceRef.current || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.stopPropagation();
    disarmPeek();
    engageDragChrome();
    const start = toWorld(event.clientX, event.clientY);
    frameDragRef.current = {
      serial: (frameSerial.current += 1),
      pointerId: event.pointerId,
      childId: frame.childId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: start.x,
      startWorldY: start.y,
      originX: frame.x,
      originY: frame.y,
      anchorX: frame.anchorX,
      anchorY: frame.anchorY,
      dx: 0,
      dy: 0,
      moved: false,
    };
  }

  useEffect(() => {
    if (props.onMoveInclusion === undefined) return;
    const onPointerMove = (event: PointerEvent) => {
      const drag = frameDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.moved) {
        const dist = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
        if (dist <= 4) return;
        drag.moved = true;
        window.getSelection()?.removeAllRanges();
      }
      const now = toWorld(event.clientX, event.clientY);
      const next = snapPoint(
        { x: drag.originX + (now.x - drag.startWorldX), y: drag.originY + (now.y - drag.startWorldY) },
        snapRef.current,
      );
      drag.dx = next.x - drag.originX;
      drag.dy = next.y - drag.originY;
      setFrameShift({ childId: drag.childId, dx: drag.dx, dy: drag.dy, anchorX: drag.anchorX, anchorY: drag.anchorY });
    };
    const finish = (event: PointerEvent, commit: boolean) => {
      const drag = frameDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      frameDragRef.current = null;
      releaseDragChrome();
      if (drag.moved) dragEndAtRef.current = performance.now();
      const serial = drag.serial;
      if (!commit || !drag.moved) {
        if (frameSerial.current === serial) setFrameShift(null);
        return;
      }
      const move = onMoveInclusionRef.current;
      if (frameSerial.current === serial) setFrameShift(null);
      if (!move) return;
      void move(drag.childId, drag.anchorX + drag.dx, drag.anchorY + drag.dy);
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
      releaseDragChrome();
    };
  }, [props.onMoveInclusion !== undefined]);

  /* ---------- 调整图片宽度：不改 x、y、z，失败回到按下时的宽度 ---------- */
  function rememberImageRatio(assetId: string, naturalWidth: number, naturalHeight: number) {
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    const ratio = naturalWidth / naturalHeight;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setImageRatios((current) => (current[assetId] === ratio ? current : { ...current, [assetId]: ratio }));
  }

  function beginResize(event: ReactPointerEvent, nodeId: string) {
    if (event.button !== 0) return;
    if (
      onResizeRef.current === undefined ||
      editingRef.current ||
      linkDragRef.current ||
      dragRef.current ||
      frameDragRef.current
    ) {
      return;
    }
    const box = boxOf.get(nodeId);
    const item = itemsRef.current.find((entry) => entry.id === nodeId);
    if (!box || item?.kind !== 'image' || item.uploading) return;
    event.stopPropagation();
    event.preventDefault();
    disarmPeek();
    engageDragChrome();
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
      releaseDragChrome();
      if (resize.width !== resize.originWidth) dragEndAtRef.current = performance.now();
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
      releaseDragChrome();
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
    const items = itemsRef.current.filter((item) => !mindmapRef.current || mindmapDropKind(item) !== 'member');
    const laidNow = layoutPlaced(
      items.map((item) => ({ id: item.id, x: item.x ?? null, y: item.y ?? null })),
      linksRef.current,
      { x: spotCenter.x, y: spotCenter.y },
    );
    const missing = new Set(items.filter((item) => !isFiniteNumber(item.x)).map((item) => item.id));
    const spots = laidNow
      .filter((box) => missing.has(box.id))
      .map((box) => ({ id: box.id, ...snapPoint({ x: box.x, y: box.y }, snapRef.current) }));
    if (spots.length === 0) return;
    onPlaceRef.current?.(spots);
  }, [hasSaved, missingKey, spotCenter]);

  const peekBox = peekId ? boxOf.get(peekId) : undefined;
  peekBoxRef.current = peekBox ? { id: peekBox.id, x: peekBox.x, y: peekBox.y, w: peekBox.w, h: peekBox.h } : null;

  useEffect(() => {
    const stopSelect = (event: Event) => {
      if (dragRef.current || resizeRef.current || marqueeRef.current) event.preventDefault();
    };
    window.addEventListener('selectstart', stopSelect);
    return () => window.removeEventListener('selectstart', stopSelect);
  }, []);

  function placePeek(): boolean {
    const pop = peekPopRef.current;
    const g = worldRef.current;
    const box = peekBoxRef.current;
    if (!pop || !g || !box) return false;
    const host = g.ownerSVGElement?.parentElement;
    const matrix = g.getScreenCTM();
    if (!host || !matrix) {
      if (pop.style.visibility !== 'hidden') pop.style.visibility = 'hidden';
      return false;
    }
    const hostRect = host.getBoundingClientRect();
    const visible = visibleCanvas(hostRect);
    const origin = new DOMPoint(box.x, box.y).matrixTransform(matrix);
    const corner = new DOMPoint(box.x + box.w, box.y + box.h).matrixTransform(matrix);
    const card = pop.querySelector('.bpeek-card');
    const cardHeight = card instanceof HTMLElement ? card.offsetHeight : pop.offsetHeight;
    const place = peekPlacement({
      nodeLeft: origin.x - visible.left,
      nodeTop: origin.y - visible.top,
      nodeRight: corner.x - visible.left,
      nodeBottom: corner.y - visible.top,
      hostWidth: visible.width,
      hostHeight: visible.height,
      cardWidth: 240,
      cardHeight,
    });
    const placedLeft = place.left + (visible.left - hostRect.left);
    const left = `${place.flip ? placedLeft : placedLeft - 12}px`;
    const top = `${place.top + (visible.top - hostRect.top)}px`;
    if (pop.style.left !== left) pop.style.left = left;
    if (pop.style.top !== top) pop.style.top = top;
    if (pop.classList.contains('flip') !== place.flip) pop.classList.toggle('flip', place.flip);
    if (pop.style.visibility !== 'visible') pop.style.visibility = 'visible';
    return true;
  }
  applyPeekRef.current = placePeek;

  useLayoutEffect(() => {
    if (!peekId) return;
    let raf = 0;
    let tries = 0;
    const run = () => {
      tries += 1;
      if (applyPeekRef.current() || tries >= 8) return;
      raf = requestAnimationFrame(run);
    };
    run();
    const pop = peekPopRef.current;
    let frame = 0;
    const observer = pop
      ? new ResizeObserver(() => {
          if (frame !== 0) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            applyPeekRef.current();
          });
        })
      : null;
    if (pop && observer) observer.observe(pop);
    return () => {
      cancelAnimationFrame(raf);
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [peekId, peekBox?.x, peekBox?.y, peekBox?.w, peekBox?.h]);

  const canvasClass = !toolsOn ? undefined : tool === 'text' ? 'tool-text' : tool === 'connect' ? 'tool-connect' : 'tool-select';
  const chosenIds = multiOn ? (props.selectedIds ?? []) : undefined;

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
                const world = { x: point.worldX, y: point.worldY };
                const next: Editing = {
                  kind: 'create',
                  at: snapTextOrigin(world, snapRef.current),
                  groupId: groupAt(world),
                };
                editingRef.current = next;
                setEditing(next);
              }
            : undefined
        }
        grid={canvas.grid}
        contextItems={contextItems}
        blankDrag={multiOn && selectTool ? 'marquee' : 'pan'}
        onBlankPointerDown={beginMarquee}
        onPanSettled={(moved) => {
          if (moved) dragEndAtRef.current = performance.now();
        }}
        onViewChange={() => {
          applyPeekRef.current();
        }}
        overlay={
          peekBox && props.renderPeek ? (
            <div
              ref={peekPopRef}
              className="bpeek bpeek-pop"
              onPointerEnter={holdPeek}
              onPointerLeave={scheduleClosePeek}
            >
              {props.renderPeek(peekBox.id)}
            </div>
          ) : null
        }
        minimap={
          canvas.minimap ? (
            <>
              {boxes.map((box) => (
                <rect
                  key={box.id}
                  className={
                    (chosenIds ? chosenIds.includes(box.id) : props.selectedId === box.id) ? 'mm-node focus' : 'mm-node'
                  }
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  rx={6}
                />
              ))}
            </>
          ) : undefined
        }
      >
        <g ref={worldRef}>
          <InclusionFrames
            frames={frames}
            selectedId={props.selectedId}
            selectedIds={chosenIds}
            layer="back"
            onSelect={selectNode}
            onActivate={() => undefined}
            onPointerDown={beginFrameDrag}
          />
          {toolsOn ? (
            <BranchLines
              items={branchItems}
              boxOf={boxOf}
              links={props.links}
              selectedId={props.selectedId}
              editingId={editing?.kind === 'relabel' ? editing.id : null}
              appearance={appearance}
              showMarkers={canvas.markers}
              onSelectLink={(id) => {
                selectOnSingleClick(() => {
                  disarmPeek();
                  const sole = props.selectedId === id;
                  props.onSelectLink(id);
                  if (sole) props.onInspectLink?.(id);
                });
              }}
              onActivateLink={(id) => {
                cancelPendingClick();
                disarmPeek();
                if (!props.onRelabel) return;
                const next: Editing = { kind: 'relabel', id };
                editingRef.current = next;
                setEditing(next);
              }}
              onEditPlain={(pair) => {
                cancelPendingClick();
                disarmPeek();
                if (!props.onConnect) return;
                const next: Editing = { kind: 'link', fromId: pair.parentId, toId: pair.childId };
                editingRef.current = next;
                setEditing(next);
              }}
            />
          ) : null}
          <BoardEdges
            links={toolsOn ? props.links.filter((link) => !branchLinkIds(branchItems, boxOf, props.links).has(link.id)) : props.links}
            boxOf={boxOf}
            selectedId={props.selectedId}
            editingId={editing?.kind === 'relabel' ? editing.id : null}
            appearance={appearance}
            route={route}
            labels={canvas.labels}
            showMarkers={!toolsOn || canvas.markers}
            onSelect={(id) => {
              selectOnSingleClick(() => {
                disarmPeek();
                const sole = props.selectedId === id;
                props.onSelectLink(id);
                if (sole) props.onInspectLink?.(id);
              });
            }}
            onActivate={(id) => {
              cancelPendingClick();
              disarmPeek();
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
            selectedIds={chosenIds}
            renamingId={editing?.kind === 'rename' ? editing.id : null}
            onSelect={selectNode}
            onActivate={(id) => {
              cancelPendingClick();
              disarmPeek();
              if (isUploading(id)) return;
              if (toolsOn && toolRef.current === 'connect') return;
              const childId = inclusionChildId(id);
              if (childId) {
                props.onToggleInclusion?.(childId);
                return;
              }
              if (props.onOpenItem) props.onOpenItem(id);
              else if (props.onRenameItem) {
                const next: Editing = { kind: 'rename', id };
                editingRef.current = next;
                setEditing(next);
              }
            }}
            onPointerEnter={armPeek}
            onPointerLeave={scheduleClosePeek}
            onPointerDown={() => {
              cancelPendingClick();
              disarmPeek();
            }}
            onDragPointerDown={props.onMove ? beginDrag : undefined}
            onBeginLink={props.onConnect && selectTool ? beginLink : undefined}
            imageHeights={imageHeights}
            onImageLoad={rememberImageRatio}
            onBeginResizeImage={props.onResizeImage ? beginResize : undefined}
            onToggleFold={props.onToggleFold}
            showMarkers={!toolsOn || canvas.markers}
          />
          {seam ? <line className="mindmap-seam" x1={seam.x1} y1={seam.y} x2={seam.x2} y2={seam.y} /> : null}
          <InclusionFrames
            frames={frames}
            selectedId={props.selectedId}
            selectedIds={chosenIds}
            layer="front"
            onSelect={selectNode}
            onActivate={(id) => {
              cancelPendingClick();
              const childId = inclusionChildId(id);
              if (childId) props.onToggleInclusion?.(childId);
            }}
            onPointerDown={beginFrameDrag}
          />

          {linkDrag
            ? (() => {
                const from = boxOf.get(linkDrag.lineFromId);
                if (!from) return null;
                const start = anchorOnBorder(from, linkDrag.cursor);
                return (
                  <g pointerEvents="none">
                    <line
                      className="blink-temp"
                      x1={start.x}
                      y1={start.y}
                      x2={linkDrag.cursor.x}
                      y2={linkDrag.cursor.y}
                      style={{
                        stroke: EDGE_STROKE[appearance.color].line,
                        strokeWidth: EDGE_WIDTH[appearance.width],
                      }}
                    />
                    <circle className="blink-temp-dot" cx={linkDrag.cursor.x} cy={linkDrag.cursor.y} r={3.5} />
                  </g>
                );
              })()
            : null}

          {grow
            ? (() => {
                const at =
                  draftBox ??
                  (growLive
                    ? { x: growLive.x, y: growLive.y, w: NODE_W, h: MINDMAP_DRAFT_H }
                    : null);
                if (!at) return null;
                if (!grow.typing || !growLive) {
                  return (
                    <g className="node bnode on">
                      <NodeChrome x={at.x} y={at.y} w={at.w} h={at.h} selected />
                      <text className="bnode-name" x={at.x + at.w / 2} y={at.y + at.h / 2} textAnchor="middle">
                        {shortLabel(grow.name)}
                      </text>
                    </g>
                  );
                }
                const draft = growLive;
                return (
                  <g className="node bnode on">
                    <NodeChrome x={at.x} y={at.y} w={at.w} h={at.h} selected />
                    <InlineInput
                      key={draft.attempt}
                      variant="node"
                      x={at.x}
                      y={at.y}
                      w={at.w}
                      h={at.h}
                      initial={draft.name}
                      placeholder="点的名字"
                      onCommit={(name) => {
                        const current = editingRef.current;
                        if (current?.kind !== 'grow') return;
                        const known = itemsRef.current.map((item) => item.id);
                        setHoldGrow({
                          role: current.role,
                          nodeId: current.nodeId,
                          name,
                          known,
                        });
                        finishEditing();
                        void (async () => {
                          let ok: void | boolean;
                          try {
                            ok = await props.onGrowNode?.({
                              name,
                              x: at.x,
                              y: at.y,
                              groupId: current.groupId,
                              role: current.role,
                              nodeId: current.nodeId,
                            });
                          } catch {
                            ok = false;
                          }
                          if (ok !== false) return;
                          setHoldGrow(null);
                          const next: Editing = { ...current, name, attempt: current.attempt + 1 };
                          editingRef.current = next;
                          setEditing(next);
                        })();
                      }}
                      onCancel={() => {
                        if (editingRef.current?.kind !== 'grow') return;
                        stopEditing();
                      }}
                    />
                  </g>
                );
              })()
            : null}

          {editing?.kind === 'create' ? (
            <g className="node bnode on">
              <NodeChrome x={editing.at.x - NODE_W / 2} y={editing.at.y - NODE_H / 2} w={NODE_W} h={NODE_H} selected />
              <InlineInput
                variant="node"
                x={editing.at.x - NODE_W / 2}
                y={editing.at.y - INLINE_DY}
                w={NODE_W}
                h={INLINE_H}
                placeholder={props.createPlaceholder ?? ''}
                onCommit={(name) => {
                  if (editingRef.current?.kind !== 'create') return;
                  const draft = editingRef.current;
                  finishEditing();
                  props.onCreate?.(name, draft.at, draft.groupId);
                }}
                onCancel={() => {
                  if (editingRef.current?.kind !== 'create') return;
                  stopEditing();
                }}
              />
            </g>
          ) : null}
          {editing?.kind === 'rename'
            ? (() => {
                const box = boxOf.get(editing.id);
                const item = props.items.find((entry) => entry.id === editing.id);
                if (!box || !item) return null;
                // 输入文字落在节点名字的排版位置：图片点在底部名字行，文字点带描述时靠顶，否则居中。
                const desc = (item.description ?? '').trim();
                const cy = box.y + box.h / 2;
                const nameY =
                  item.kind === 'image'
                    ? box.y + box.h - IMAGE_NAME_LINE / 2
                    : desc !== ''
                      ? box.y + 15
                      : (item.types ?? []).length > 0
                        ? cy - 4
                        : cy;
                return (
                  <InlineInput
                    variant="node"
                    x={box.x}
                    y={nameY - INLINE_DY}
                    w={box.w}
                    h={INLINE_H}
                    initial={item.label}
                    placeholder={item.label}
                    onCommit={(name) => {
                      if (editingRef.current?.kind !== 'rename' || editingRef.current.id !== item.id) return;
                      finishEditing();
                      if (name !== item.label) props.onRenameItem?.(item.id, name);
                    }}
                    onCancel={() => {
                      if (editingRef.current?.kind !== 'rename' || editingRef.current.id !== item.id) return;
                      stopEditing();
                    }}
                  />
                );
              })()
            : null}
          {editing?.kind === 'link'
            ? (() => {
                const from = boxOf.get(editing.fromId);
                const to = boxOf.get(editing.toId);
                if (!from || !to) return null;
                const mid = composerPoint(editing.fromId, editing.toId, from, to);
                return (
                  <LinkComposer
                    x={mid.x - 84}
                    y={mid.y - 17}
                    w={168}
                    h={34}
                    placeholder="关系，例如：前提"
                    onCommit={(label) => {
                      if (editingRef.current?.kind !== 'link') return;
                      const draft = editingRef.current;
                      finishEditing();
                      props.onConnect?.(draft.fromId, draft.toId, label);
                    }}
                    onCancel={() => {
                      if (editingRef.current?.kind !== 'link') return;
                      stopEditing();
                    }}
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
                const mid = composerPoint(link.fromId, link.toId, from, to, lane.index, lane.count, lane.paired);
                return (
                  <LinkComposer
                    x={mid.x - 84}
                    y={mid.y - 17}
                    w={168}
                    h={34}
                    initial={link.label}
                    placeholder="关系，例如：前提"
                    onCommit={(label) => {
                      if (editingRef.current?.kind !== 'relabel' || editingRef.current.id !== link.id) return;
                      finishEditing();
                      if (label !== link.label) props.onRelabel?.(link.id, label);
                    }}
                    onCancel={() => {
                      if (editingRef.current?.kind !== 'relabel' || editingRef.current.id !== link.id) return;
                      stopEditing();
                    }}
                  />
                );
              })()
            : null}
          {marqueeRect ? (
            <rect className="marquee" x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.w} height={marqueeRect.h} />
          ) : null}
        </g>
      </GraphViewport>
      {toolsOn ? (
        <BoardToolbar
          tool={tool}
          onTool={chooseTool}
          onImage={pickImages}
          onInsertInclusion={
            props.onInsertInclusion
              ? () => askInsert(readViewportCenter(worldRef.current) ?? { x: 48, y: 48 })
              : undefined
          }
          settingsOpen={settingsOpen}
          appearance={appearance}
          canvas={canvas}
          layoutDirection={props.layoutDirection}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
          onAppearance={(next) => props.onAppearance?.(next)}
          onCanvas={(patch) => props.onCanvas?.(patch)}
          onLayoutDirection={props.onLayoutDirection}
        />
      ) : null}
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
