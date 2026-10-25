import { useEffect, useState } from 'react';
import { UField, UTextInput } from '../ui/field/field.js';

export function NameField(props: {
  id: string;
  label: string;
  value: string;
  maxLength?: number;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);

  useEffect(() => {
    setDraft(props.value);
  }, [props.id, props.value]);

  return (
    <UField label={props.label} htmlFor={`name-${props.id}`}>
      <UTextInput
        id={`name-${props.id}`}
        value={draft}
        maxLength={props.maxLength ?? 80}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft.trim();
          if (next === '' || next === props.value) {
            setDraft(props.value);
            return;
          }
          props.onSave(next);
        }}
      />
    </UField>
  );
}
