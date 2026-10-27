import type { Card } from '@unfold/dto';
import { useEffect, useRef, useState } from 'react';
import { createHandoff } from '../../shared/save/handoff.js';
import { noteDraft } from '../../shared/save/save-bus.js';
import { takeServerText } from '../../shared/save/server-text.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';
import { USelect } from '../../shared/ui/select/select.js';
import { CardFrame } from './card-frame.js';
import { codeLanguageOptions, codeLanguageValue } from './code-language.js';
import { CodeEditor } from './code-editor.js';
import { text } from './content.js';
import './code-card.css';

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

  function chooseLanguage(next: string) {
    if (next === languageRef.current) return;
    languageRef.current = next;
    setLanguage(next);
    hand.edit();
    void commit();
  }

  const selected = codeLanguageValue(language);

  return (
    <CardFrame
      type="code"
      className="kind-code"
      onDelete={props.onDelete}
      headerExtra={
        <USelect
          ariaLabel="语言"
          value={selected}
          options={codeLanguageOptions(language)}
          onChange={chooseLanguage}
        />
      }
    >
      <CodeEditor
        source={source}
        language={language}
        autoFocus={initialSource.trim() === ''}
        onChange={(next) => {
          sourceRef.current = next;
          setSource(next);
          hand.edit();
        }}
        onBlur={() => {
          void commit();
        }}
      />
    </CardFrame>
  );
}
