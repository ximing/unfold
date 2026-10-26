import { useEffect, useRef, useState } from 'react';
import { createHandoff } from '../save/handoff.js';
import { noteDraft } from '../save/save-bus.js';
import { takeServerText } from '../save/server-text.js';
import { useSaveDraft } from '../save/use-save-draft.js';
import { UField, UTextInput } from '../ui/field/field.js';

export function NameField(props: {
  id: string;
  label: string;
  value: string;
  maxLength?: number;
  onSave: (value: string) => Promise<boolean> | void;
}) {
  const [draft, setDraft] = useState(props.value);
  const draftRef = useRef(props.value);
  const savedRef = useRef(props.value);
  const idRef = useRef(props.id);
  const hand = useRef(createHandoff()).current;
  draftRef.current = draft;

  useEffect(() => {
    const switched = idRef.current !== props.id;
    idRef.current = props.id;
    const decision = takeServerText(draftRef.current.trim(), savedRef.current, props.value, switched);
    if (decision === 'keep') {
      noteDraft();
      return;
    }
    if (decision === 'echo') {
      savedRef.current = props.value;
      noteDraft();
      return;
    }
    savedRef.current = props.value;
    draftRef.current = props.value;
    setDraft(props.value);
    noteDraft();
  }, [props.id, props.value]);

  function commit() {
    const next = draftRef.current.trim();
    if (next === '') {
      draftRef.current = savedRef.current;
      setDraft(savedRef.current);
      noteDraft();
      return;
    }
    return hand.send(next, savedRef.current, () => props.onSave(next));
  }

  useSaveDraft(
    () => hand.dirty(draftRef.current.trim(), savedRef.current),
    () => {
      void commit();
    },
  );

  return (
    <UField label={props.label} htmlFor={`name-${props.id}`}>
      <UTextInput
        id={`name-${props.id}`}
        value={draft}
        maxLength={props.maxLength ?? 80}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
          hand.edit();
        }}
        onBlur={() => {
          void commit();
        }}
      />
    </UField>
  );
}
