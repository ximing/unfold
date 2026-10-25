import { observer, useService } from '@rabjs/react';
import type { Card } from '@unfold/dto';
import { cardMeta } from '../cards/card-meta.js';
import { LibraryService } from '../library/library.service.js';

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 悬停预览里的一段摘录：第一张有字的卡片 */
function peekText(cards: Card[]): string {
  for (const card of cards) {
    const joined = Object.values(card.content)
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

export const NodePeek = observer(function NodePeek(props: { nodeId: string; name: string; count: number }) {
  const library = useService(LibraryService);
  const peek = library.peek?.id === props.nodeId ? library.peek : null;
  const snippet = peek ? peekText(peek.cards) : '';
  const types = peek ? [...new Set(peek.cards.map((card) => card.type))] : [];
  const description = peek?.description?.trim() ?? '';
  return (
    <div className="bpeek-card">
      <p className="pk-name">
        {props.name}
        <span className="pk-cnt">{props.count > 0 ? `${props.count} 张卡片` : ''}</span>
      </p>
      {description !== '' ? <p className="pk-desc">{description}</p> : null}
      {types.length > 0 ? (
        <p className="pk-dots">
          {types.map((type) => (
            <i key={type} style={{ background: cardMeta(type).hue }} />
          ))}
        </p>
      ) : null}
      {!peek ? <p className="pk-none">正在读取…</p> : snippet !== '' ? <p className="pk-text">{snippet}</p> : null}
      {peek && snippet === '' && types.length === 0 ? <p className="pk-none">还没有卡片</p> : null}
    </div>
  );
});
