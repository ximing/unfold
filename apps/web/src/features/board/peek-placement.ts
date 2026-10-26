export type PeekPlacement = { left: number; top: number; flip: boolean };

/** 预览贴在点的旁边。右侧放得下就放右侧，否则放左侧。上下留在视口里。坐标相对视口。 */
export function peekPlacement(args: {
  nodeLeft: number;
  nodeTop: number;
  nodeRight: number;
  nodeBottom: number;
  hostWidth: number;
  hostHeight: number;
  cardWidth: number;
  cardHeight: number;
  gap?: number;
  margin?: number;
}): PeekPlacement {
  const gap = args.gap ?? 12;
  const margin = args.margin ?? 8;
  const spaceRight = args.hostWidth - args.nodeRight;
  const spaceLeft = args.nodeLeft;
  const need = args.cardWidth + gap + margin;
  const flip = spaceRight < need && spaceLeft > spaceRight;
  const rawLeft = flip ? args.nodeLeft - gap - args.cardWidth : args.nodeRight + gap;
  const maxLeft = Math.max(margin, args.hostWidth - args.cardWidth - margin);
  const left = Math.min(Math.max(rawLeft, margin), maxLeft);
  const rawTop = args.nodeTop;
  const maxTop = Math.max(margin, args.hostHeight - args.cardHeight - margin);
  const top = Math.min(Math.max(rawTop, margin), maxTop);
  return { left, top, flip };
}
