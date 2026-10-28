export const RICH_IMAGE_MIN_WIDTH = 32;
export const RICH_IMAGE_MAX_WIDTH = 1200;

/** 文稿图片的展示宽度。取整后夹在 32 到 1200，并且不超过所在区域。scale 是画面像素相对 CSS 像素的比例。 */
export function richImageDisplayWidth(startWidth: number, delta: number, limit: number, scale = 1): number {
  const start = Number.isFinite(startWidth) ? startWidth : RICH_IMAGE_MIN_WIDTH;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const moved = (Number.isFinite(delta) ? delta : 0) / safeScale;
  const room = Number.isFinite(limit) ? limit : RICH_IMAGE_MAX_WIDTH;
  const cap = Math.min(RICH_IMAGE_MAX_WIDTH, Math.max(RICH_IMAGE_MIN_WIDTH, Math.floor(room)));
  return Math.min(cap, Math.max(RICH_IMAGE_MIN_WIDTH, Math.round(start + moved)));
}

/** 画面宽度没变，或指针几乎没动时，不写入。 */
export function richImageWidthCommit(startWidth: number, delta: number, next: number): number | null {
  if (!Number.isFinite(startWidth) || !Number.isFinite(delta) || !Number.isFinite(next)) return null;
  if (Math.abs(delta) < 1) return null;
  if (next === Math.round(startWidth)) return null;
  return next;
}
