import type { Card } from '@unfold/dto';
import { CardFrame } from './card-frame.js';
import { text } from './content.js';
import { NoteEditor } from './note-editor.js';

export function NoteCard(props: {
  card: Card;
  onUpdate: (content: Card['content']) => Promise<boolean> | void;
  onDelete: () => void;
}) {
  return (
    <CardFrame type="note" className="kind-note" onDelete={props.onDelete}>
      <NoteEditor
        key={props.card.id}
        html={text(props.card.content, 'body')}
        onSave={(html) => props.onUpdate({ body: html })}
      />
    </CardFrame>
  );
}
