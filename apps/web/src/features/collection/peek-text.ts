import type { Card } from '@unfold/dto';

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentStrings(content: Card['content']): string[] {
  const values = Object.values(content as Record<string, unknown>);
  return values.filter((value): value is string => typeof value === 'string');
}

/** 悬停预览里的一段摘录：第一张有字的卡片。只拼接字符串字段。 */
export function peekText(cards: Card[]): string {
  for (const card of cards) {
    const joined = contentStrings(card.content)
      .map((value) => stripHtml(value))
      .filter((value) => value !== '')
      .join(' · ');
    if (joined !== '') {
      const chars = [...joined];
      return chars.length <= 90 ? joined : `${chars.slice(0, 89).join('')}…`;
    }
  }
  return '';
}
