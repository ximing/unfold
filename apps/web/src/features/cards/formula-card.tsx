import type { Card } from '@unfold/dto';
import katex from 'katex';
import { useEffect, useState } from 'react';
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

export function FormulaCard(props: { card: Card; onUpdate: (content: Card['content']) => void; onDelete: () => void }) {
  const [latex, setLatex] = useState(text(props.card.content, 'latex'));
  useEffect(() => setLatex(text(props.card.content, 'latex')), [props.card.id, props.card.content]);
  return (
    <CardFrame type="formula" className="kind-formula" onDelete={props.onDelete}>
      <UTextInput
        aria-label="公式"
        placeholder="LaTeX"
        value={latex}
        onChange={(event) => setLatex(event.target.value)}
        onBlur={() => {
          if (latex !== text(props.card.content, 'latex')) props.onUpdate({ latex });
        }}
      />
      <FormulaPreview latex={latex} />
    </CardFrame>
  );
}
