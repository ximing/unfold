/** 子集合边框的内边距、标题条高度，以及没有已摆放点时的边框大小。 */
export const INCLUSION_PAD = 28;
export const INCLUSION_TITLE = 32;
export const INCLUSION_EMPTY_W = 280;
export const INCLUSION_EMPTY_H = 160;

/**
 * 创建时客户端给出边框左上角。锚点让已摆放点的最小坐标落在边框内边距处。
 * 没有已摆放的点时，锚点就是这个左上角。
 */
export function anchorForFrameOrigin(
  origin: { x: number; y: number },
  points: readonly { x: number | null; y: number | null }[],
): { x: number; y: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const point of points) {
    if (typeof point.x !== 'number' || typeof point.y !== 'number') continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: origin.x, y: origin.y };
  return {
    x: origin.x - minX + INCLUSION_PAD,
    y: origin.y - minY + INCLUSION_PAD + INCLUSION_TITLE,
  };
}
