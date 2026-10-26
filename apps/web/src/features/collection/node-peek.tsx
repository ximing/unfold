import { observer, useService } from '@rabjs/react';
import { cardMeta } from '../cards/card-meta.js';
import { LibraryService } from '../library/library.service.js';
import { peekText } from './peek-text.js';

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
