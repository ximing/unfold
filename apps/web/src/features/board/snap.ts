export const GRID_STEP = 16;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

export function snapPoint(point: { x: number; y: number }, enabled: boolean): { x: number; y: number } {
  if (!enabled) return point;
  return { x: snapToGrid(point.x), y: snapToGrid(point.y) };
}

/** 文字点点击位置换算成左上角后再贴格，输入框仍对着这个点。 */
export function snapTextOrigin(at: { x: number; y: number }, enabled: boolean): { x: number; y: number } {
  if (!enabled) return at;
  return {
    x: snapToGrid(at.x - 84) + 84,
    y: snapToGrid(at.y - 28) + 28,
  };
}
