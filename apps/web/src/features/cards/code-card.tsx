import type { Card } from '@unfold/dto';
import hljs from 'highlight.js/lib/common';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createHandoff } from '../../shared/save/handoff.js';
import { noteDraft } from '../../shared/save/save-bus.js';
import { takeServerText } from '../../shared/save/server-text.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';
import { UTextArea, UTextInput } from '../../shared/ui/field/field.js';
import { CardFrame } from './card-frame.js';
import { text } from './content.js';

function snap(language: string, source: string): string {
  return JSON.stringify([language, source]);
}

export function CodeCard(props: {
  card: Card;
  onUpdate: (content: Card['content']) => Promise<boolean> | void;
  onDelete: () => void;
}) {
  const initialLanguage = text(props.card.content, 'language');
  const initialSource = text(props.card.content, 'source');
  const [language, setLanguage] = useState(initialLanguage);
  const [source, setSource] = useState(initialSource);
  const [editing, setEditing] = useState(initialSource.trim() === '');
  const languageRef = useRef(initialLanguage);
  const sourceRef = useRef(initialSource);
  const savedRef = useRef(snap(initialLanguage, initialSource));
  const cardIdRef = useRef(props.card.id);
  const hand = useRef(createHandoff()).current;
  languageRef.current = language;
  sourceRef.current = source;

  useEffect(() => {
    const nextLanguage = text(props.card.content, 'language');
    const nextSource = text(props.card.content, 'source');
    const incoming = snap(nextLanguage, nextSource);
    const switched = cardIdRef.current !== props.card.id;
    cardIdRef.current = props.card.id;
    const decision = takeServerText(snap(languageRef.current, sourceRef.current), savedRef.current, incoming, switched);
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
    languageRef.current = nextLanguage;
    sourceRef.current = nextSource;
    setLanguage(nextLanguage);
    setSource(nextSource);
    if (switched) setEditing(nextSource.trim() === '');
    noteDraft();
  }, [props.card.id, props.card.content]);

  function commit() {
    const nextLanguage = languageRef.current;
    const nextSource = sourceRef.current;
    return hand.send(snap(nextLanguage, nextSource), savedRef.current, () =>
      props.onUpdate({ language: nextLanguage, source: nextSource }),
    );
  }

  useSaveDraft(
    () => hand.dirty(snap(languageRef.current, sourceRef.current), savedRef.current),
    () => {
      void commit();
    },
  );

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
        onChange={(event) => {
          languageRef.current = event.target.value;
          setLanguage(event.target.value);
          hand.edit();
        }}
        onBlur={() => {
          void commit();
        }}
      />
      {editing ? (
        <UTextArea
          aria-label="代码"
          autoFocus
          value={source}
          onChange={(event) => {
            sourceRef.current = event.target.value;
            setSource(event.target.value);
            hand.edit();
          }}
          onBlur={() => {
            void commit();
            if (sourceRef.current.trim() !== '') setEditing(false);
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
