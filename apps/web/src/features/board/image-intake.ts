import { placeNewCorners } from './board-layout.js';

export const IMAGE_FORMAT_MESSAGE = '只能放入 JPEG、PNG、WebP 或 GIF';
export const IMAGE_SIZE_MESSAGE = '图片不能超过 10 MB';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

/** 缺省图片盒子半宽 110、半高 121，center 把视野中心换成左上角。 */
const CENTER_ORIGIN_X = 110;
const CENTER_ORIGIN_Y = 121;

function imageMime(type: string): string {
  return type.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function imageFileIssue(file: { type: string; size: number }): string | null {
  if (file.size > MAX_IMAGE_BYTES) return IMAGE_SIZE_MESSAGE;
  const mime = imageMime(file.type);
  if (mime === '' || IMAGE_MIME.has(mime)) return null;
  return IMAGE_FORMAT_MESSAGE;
}

export function imageDropSpots(
  anchor: 'center' | 'corner',
  at: { x: number; y: number },
  count: number,
  occupied: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  if (count < 1) return [];
  const origin = anchor === 'center' ? { x: at.x - CENTER_ORIGIN_X, y: at.y - CENTER_ORIGIN_Y } : at;
  return placeNewCorners(count, origin, occupied);
}
