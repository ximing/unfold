import type { Card, CardType } from '@unfold/dto';
import { useEffect, useRef, useState } from 'react';
import { createHandoff } from '../../shared/save/handoff.js';
import { noteDraft } from '../../shared/save/save-bus.js';
import { takeServerText } from '../../shared/save/server-text.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';
import { UDateField } from '../../shared/ui/date-field/date-field.js';
import { UTextArea, UTextInput } from '../../shared/ui/field/field.js';
import { CardFrame } from './card-frame.js';
import { text } from './content.js';

export type LineField = { key: string; label: string; kind?: 'text' | 'area' | 'date' };

function readFields(fields: LineField[], content: Card['content']): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, text(content, field.key)]));
}

function pack(fields: LineField[], record: Record<string, string>): string {
  return JSON.stringify(fields.map((field) => record[field.key] ?? ''));
}

export function LinesCard(props: {
  card: Card;
  type: CardType;
  className: string;
  fields: LineField[];
  onUpdate: (content: Card['content']) => Promise<boolean> | void;
  onDelete: () => void;
}) {
  const initial = readFields(props.fields, props.card.content);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const valuesRef = useRef(initial);
  const savedRef = useRef(pack(props.fields, initial));
  const cardIdRef = useRef(props.card.id);
  const hand = useRef(createHandoff()).current;
  valuesRef.current = values;

  useEffect(() => {
    const incomingRecord = readFields(props.fields, props.card.content);
    const incoming = pack(props.fields, incomingRecord);
    const switched = cardIdRef.current !== props.card.id;
    cardIdRef.current = props.card.id;
    const decision = takeServerText(pack(props.fields, valuesRef.current), savedRef.current, incoming, switched);
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
    valuesRef.current = incomingRecord;
    setValues(incomingRecord);
    noteDraft();
  }, [props.card.id, props.card.content, props.fields]);

  function save(next: Record<string, string>) {
    return hand.send(pack(props.fields, next), savedRef.current, () =>
      props.onUpdate(
        Object.fromEntries(props.fields.map((field) => [field.key, next[field.key] ?? ''])) as Card['content'],
      ),
    );
  }

  useSaveDraft(
    () => hand.dirty(pack(props.fields, valuesRef.current), savedRef.current),
    () => {
      void save(valuesRef.current);
    },
  );

  function change(key: string, value: string) {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    setValues(next);
    hand.edit();
  }

  return (
    <CardFrame type={props.type} className={props.className} onDelete={props.onDelete}>
      {props.fields.map((field) => (
        <label key={field.key} className="kind-line">
          <span>{field.label}</span>
          {field.kind === 'date' ? (
            <UDateField
              ariaLabel={field.label}
              value={values[field.key] ?? ''}
              onCommit={(value) => {
                const next = { ...valuesRef.current, [field.key]: value };
                valuesRef.current = next;
                setValues(next);
                return save(next);
              }}
            />
          ) : field.kind === 'area' ? (
            <UTextArea
              aria-label={field.label}
              rows={2}
              value={values[field.key] ?? ''}
              onChange={(event) => change(field.key, event.target.value)}
              onBlur={() => {
                void save(valuesRef.current);
              }}
            />
          ) : (
            <UTextInput
              aria-label={field.label}
              value={values[field.key] ?? ''}
              onChange={(event) => change(field.key, event.target.value)}
              onBlur={() => {
                void save(valuesRef.current);
              }}
            />
          )}
        </label>
      ))}
    </CardFrame>
  );
}

export const PERSON_FIELDS: LineField[] = [
  { key: 'identity', label: '身份' },
  { key: 'note', label: '备注', kind: 'area' },
];
export const EVENT_FIELDS: LineField[] = [
  { key: 'when', label: '时间', kind: 'date' },
  { key: 'where', label: '地点' },
  { key: 'summary', label: '经过', kind: 'area' },
];
export const PLACE_FIELDS: LineField[] = [{ key: 'note', label: '备注', kind: 'area' }];
export const PERIOD_FIELDS: LineField[] = [
  { key: 'start', label: '起', kind: 'date' },
  { key: 'end', label: '止', kind: 'date' },
  { key: 'note', label: '备注', kind: 'area' },
];
export const GROUP_FIELDS: LineField[] = [{ key: 'note', label: '备注', kind: 'area' }];

