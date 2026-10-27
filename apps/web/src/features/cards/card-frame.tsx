import type { CardType } from '@unfold/dto';
import type { ReactNode } from 'react';
import { cardMeta } from './card-meta.js';

export function CardFrame(props: {
  type: CardType;
  className: string;
  onDelete: () => void;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const meta = cardMeta(props.type);
  return (
    <article className={`kind-card ${props.className}`}>
      <header>
        <i className="kind-glyph" style={{ background: meta.hue }}>
          {meta.glyph}
        </i>
        <span className="kind-name">{meta.label}</span>
        {props.headerExtra}
        <button type="button" className="kind-delete" onClick={props.onDelete}>
          删除
        </button>
      </header>
      {props.children}
    </article>
  );
}
