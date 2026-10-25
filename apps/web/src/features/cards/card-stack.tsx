import type { Card, CardType } from '@unfold/dto';
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
import './card-stack.css';

function OneCard(props: { card: Card; onUpdate: (content: Card['content']) => void; onDelete: () => void }) {
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
    default:
      return null;
  }
}

export function CardStack(props: {
  cards: Card[];
  onCreate: (type: CardType) => void;
  onUpdate: (id: string, content: Card['content']) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="card-stack">
      <div className="card-add">
        {CARD_TYPES.map((type) => {
          const meta = cardMeta(type);
          return (
            <button key={type} type="button" className="card-add-btn" onClick={() => props.onCreate(type)}>
              <i style={{ background: meta.hue }}>{meta.glyph}</i>
              {meta.label}
            </button>
          );
        })}
      </div>
      {props.cards.map((card) => (
        <OneCard
          key={card.id}
          card={card}
          onUpdate={(content) => props.onUpdate(card.id, content)}
          onDelete={() => props.onDelete(card.id)}
        />
      ))}
    </div>
  );
}
