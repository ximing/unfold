import type { Card } from '@unfold/dto';
import katex from 'katex';
import { useEffect, useRef, useState } from 'react';
import { createHandoff } from '../../shared/save/handoff.js';
import { noteDraft } from '../../shared/save/save-bus.js';
import { takeServerText } from '../../shared/save/server-text.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';
import { UTextInput } from '../../shared/ui/field/field.js';
import { CardFrame } from './card-frame.js';
import { text } from './content.js';

function FormulaPreview(props: { latex: string }) {
  if (props.latex.trim() === '') return null;
  try {
    const html = katex.renderToString(props.latex, { throwOnError: true, displayMode: true });
    return <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <p className="preview-error">公式还没法排</p>;
  }
}

export function FormulaCard(props: {
  card: Card;
  onUpdate: (content: Card['content']) => Promise<boolean> | void;
  onDelete: () => void;
}) {
  const initial = text(props.card.content, 'latex');
  const [latex, setLatex] = useState(initial);
  const latexRef = useRef(initial);
  const savedRef = useRef(initial);
  const cardIdRef = useRef(props.card.id);
  const hand = useRef(createHandoff()).current;
  latexRef.current = latex;

  useEffect(() => {
    const incoming = text(props.card.content, 'latex');
    const switched = cardIdRef.current !== props.card.id;
    cardIdRef.current = props.card.id;
    const decision = takeServerText(latexRef.current, savedRef.current, incoming, switched);
    if (decision === 'keep') {
      noteDraft();
      return;
    }
    if (decision === 'echo') {
      savedRef.current = incoming;
      noteDraft();
      return;
    }
    savedRef.current = incoming;
    latexRef.current = incoming;
    setLatex(incoming);
    noteDraft();
  }, [props.card.id, props.card.content]);

  function commit() {
    return hand.send(latexRef.current, savedRef.current, () => props.onUpdate({ latex: latexRef.current }));
  }

  useSaveDraft(
    () => hand.dirty(latexRef.current, savedRef.current),
    () => {
      void commit();
    },
  );

  return (
    <CardFrame type="formula" className="kind-formula" onDelete={props.onDelete}>
      <UTextInput
        aria-label="公式"
        placeholder="LaTeX"
        value={latex}
        onChange={(event) => {
          latexRef.current = event.target.value;
          setLatex(event.target.value);
          hand.edit();
        }}
        onBlur={() => {
          void commit();
        }}
      />
      <FormulaPreview latex={latex} />
    </CardFrame>
  );
}
