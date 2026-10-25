import type { CardType } from '@unfold/dto';

export type CardMeta = {
  type: CardType;
  label: string;
  /** 徽标点、卡眉、选择器共用 */
  hue: string;
  /** 一字徽记，用在添加按钮和卡片眉上 */
  glyph: string;
};

/**
 * 卡片类型注册表：新卡片类型在这里加一行，
 * 添加按钮、卡片眉、图上徽标点会同时获得它的颜色与徽记。
 */
export const CARD_META: Record<CardType, CardMeta> = {
  note: { type: 'note', label: '笔记', hue: '#64748B', glyph: '文' },
  code: { type: 'code', label: '代码', hue: '#0F766E', glyph: '码' },
  formula: { type: 'formula', label: '公式', hue: '#7C3AED', glyph: '∑' },
  person: { type: 'person', label: '人物', hue: '#9333EA', glyph: '人' },
  event: { type: 'event', label: '事件', hue: '#0891B2', glyph: '事' },
  place: { type: 'place', label: '地点', hue: '#059669', glyph: '地' },
  period: { type: 'period', label: '时段', hue: '#B45309', glyph: '时' },
  group: { type: 'group', label: '群体', hue: '#DC5F02', glyph: '群' },
};

export const CARD_TYPES = Object.keys(CARD_META) as CardType[];

export function cardMeta(type: CardType): CardMeta {
  return CARD_META[type];
}
