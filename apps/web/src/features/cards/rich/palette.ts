export const FONT_SIZES = ['12', '13', '14', '15', '16', '18', '20', '22', '24', '28', '32', '36'] as const;

export const TEXT_COLORS = [
  { name: '赤', value: '#b3402a' },
  { name: '赭', value: '#9a6232' },
  { name: '绿', value: '#2f7d4a' },
  { name: '蓝', value: '#2a5f9e' },
  { name: '紫', value: '#6a4c93' },
  { name: '墨', value: '#221d16' },
  { name: '灰', value: '#6f675c' },
] as const;

export const BACKGROUND_COLORS = [
  { name: '黄', value: '#f6e7a8' },
  { name: '绿', value: '#d7efd4' },
  { name: '蓝', value: '#d6e6f7' },
  { name: '粉', value: '#f8d6d0' },
  { name: '紫', value: '#e7dff6' },
  { name: '灰', value: '#ece7df' },
] as const;

const FONT_SIZE_SET = new Set<string>(FONT_SIZES);

const HEX = /^#([0-9a-f]{6})$/i;
const SHORT_HEX = /^#([0-9a-f]{3})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i;

export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const hex = HEX.exec(text);
  if (hex?.[1]) return `#${hex[1].toLowerCase()}`;
  const short = SHORT_HEX.exec(text);
  if (short?.[1]) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgb = RGB.exec(text);
  if (!rgb?.[1] || !rgb[2] || !rgb[3]) return null;
  const channel = (part: string) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0');
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
}

export function normalizeFontSize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase().replace(/px$/, '');
  return FONT_SIZE_SET.has(raw) ? raw : null;
}

export function parseCustomColor(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  return normalizeColor(text.startsWith('#') ? text : `#${text}`);
}
