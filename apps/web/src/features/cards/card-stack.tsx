import type { Card, CardType } from '@unfold/dto';
import { useEffect } from 'react';
import 'highlight.js/styles/github.css';
import { CARD_TYPES, cardMeta } from './card-meta.js';
import { CodeCard } from './code-card.js';
import { FormulaCard } from './formula-card.js';
import {
  EVENT_FIELDS,
  GROUP_FIELDS,
  LinesCard,
  PERIOD_FIELDS,
  PERSON_FIELDS,
  PLACE_FIELDS,
} from './lines-card.js';
import { NoteCard } from './note-card.js';
import { RichCard } from './rich/rich-editor.js';
import './card-stack.css';

function OneCard(props: {
  card: Card;
  onUpdate: (content: Card['content']) => Promise<boolean> | void;
  onDelete: () => void;
}) {
  switch (props.card.type) {
    case 'note':
      return <NoteCard card={props.card} onUpdate={props.onUpdate} onDelete={props.onDelete} />;
    case 'code':
      return <CodeCard card={props.card} onUpdate={props.onUpdate} onDelete={props.onDelete} />;
    case 'formula':
      return <FormulaCard card={props.card} onUpdate={props.onUpdate} onDelete={props.onDelete} />;
    case 'person':
      return (
        <LinesCard
          card={props.card}
          type="person"
          className="kind-person"
          fields={PERSON_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'event':
      return (
        <LinesCard
          card={props.card}
          type="event"
          className="kind-event"
          fields={EVENT_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'place':
      return (
        <LinesCard
          card={props.card}
          type="place"
          className="kind-place"
          fields={PLACE_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'period':
      return (
        <LinesCard
          card={props.card}
          type="period"
          className="kind-period"
          fields={PERIOD_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'group':
      return (
        <LinesCard
          card={props.card}
          type="group"
          className="kind-group"
          fields={GROUP_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'rich':
      return (
        <RichCard
          cardId={props.card.id}
          doc={props.card.content.doc}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    default:
      return null;
  }
}

export function CardStack(props: {
  cards: Card[];
  types?: CardType[];
  /** 点的检查器自己画添加按钮时关掉这一排。 */
  hideAdd?: boolean;
  focusCardId?: string | null;
  onCreate: (type: CardType) => void;
  onUpdate: (id: string, content: Card['content']) => Promise<boolean> | void;
  onDelete: (id: string) => void;
}) {
  const types = props.types ?? CARD_TYPES;
  useEffect(() => {
    if (!props.focusCardId) return;
    document.getElementById(`card-${props.focusCardId}`)?.scrollIntoView({ block: 'nearest' });
  }, [props.focusCardId, props.cards]);
  return (
    <div className="card-stack">
      {props.hideAdd ? null : (
        <div className="card-add">
          {types.map((type) => {
            const meta = cardMeta(type);
            return (
              <button key={type} type="button" className="card-add-btn" onClick={() => props.onCreate(type)}>
                <i style={{ background: meta.hue }}>{meta.glyph}</i>
                {meta.label}
              </button>
            );
          })}
        </div>
      )}
      {props.cards.map((card) => (
        <div key={card.id} id={`card-${card.id}`}>
          <OneCard
            card={card}
            onUpdate={(content) => props.onUpdate(card.id, content)}
            onDelete={() => props.onDelete(card.id)}
          />
        </div>
      ))}
    </div>
  );
}
