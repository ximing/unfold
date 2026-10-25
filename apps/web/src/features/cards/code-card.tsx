import type { Card } from '@unfold/dto';
import hljs from 'highlight.js/lib/common';
import { useEffect, useMemo, useState } from 'react';
import { UTextArea, UTextInput } from '../../shared/ui/field/field.js';
import { CardFrame } from './card-frame.js';
import { text } from './content.js';

export function CodeCard(props: { card: Card; onUpdate: (content: Card['content']) => void; onDelete: () => void }) {
  const [language, setLanguage] = useState(text(props.card.content, 'language'));
  const [source, setSource] = useState(text(props.card.content, 'source'));
  const [editing, setEditing] = useState(text(props.card.content, 'source').trim() === '');
  useEffect(() => {
    setLanguage(text(props.card.content, 'language'));
    setSource(text(props.card.content, 'source'));
  }, [props.card.id, props.card.content]);

  function save(nextLanguage: string, nextSource: string) {
    if (
      nextLanguage === text(props.card.content, 'language') &&
      nextSource === text(props.card.content, 'source')
    ) {
      return;
    }
    props.onUpdate({ language: nextLanguage, source: nextSource });
  }

  const highlighted = useMemo(() => {
    if (source.trim() === '') return null;
    try {
      const lang = language.trim().toLowerCase();
      if (lang !== '' && hljs.getLanguage(lang)) return hljs.highlight(source, { language: lang }).value;
      return hljs.highlightAuto(source).value;
    } catch {
      return null;
    }
  }, [language, source]);

  return (
    <CardFrame type="code" className="kind-code" onDelete={props.onDelete}>
      <UTextInput
        aria-label="语言"
        placeholder="语言"
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        onBlur={() => save(language, source)}
      />
      {editing ? (
        <UTextArea
          aria-label="代码"
          autoFocus
          value={source}
          onChange={(event) => setSource(event.target.value)}
          onBlur={() => {
            save(language, source);
            if (source.trim() !== '') setEditing(false);
          }}
        />
      ) : highlighted ? (
        <pre className="code-view" onClick={() => setEditing(true)}>
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      ) : (
        <pre className="code-view plain" onClick={() => setEditing(true)}>
          <code>{source}</code>
        </pre>
      )}
    </CardFrame>
  );
}
