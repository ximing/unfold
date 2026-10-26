/** 图片下方名字行的高度。画布和测试都用这个值。 */
export const IMAGE_NAME_LINE = 22;

const MIN_IMAGE_WIDTH = 120;
const MAX_IMAGE_WIDTH = 480;
const DEFAULT_IMAGE_WIDTH = 220;

/** 图片点盒子。宽缺省 220，夹到 120–480；高度按宽高比，非法比例当正方形。 */
export function imageFrame(
  imageWidth: number | null | undefined,
  ratio: number,
): { w: number; pictureH: number; h: number } {
  const finite = typeof imageWidth === 'number' && Number.isFinite(imageWidth);
  const rounded = finite ? Math.round(imageWidth) : DEFAULT_IMAGE_WIDTH;
  const w = Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, rounded));
  const safeRatio = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  const pictureH = Math.max(1, Math.round(w / safeRatio));
  return { w, pictureH, h: pictureH + IMAGE_NAME_LINE };
}
