import type { Card, CardType } from '@unfold/dto';
import { useEffect, useState } from 'react';
import { UDateField } from '../../shared/ui/date-field/date-field.js';
import { UTextArea, UTextInput } from '../../shared/ui/field/field.js';
import { CardFrame } from './card-frame.js';
import { text } from './content.js';

export type LineField = { key: string; label: string; kind?: 'text' | 'area' | 'date' };

export function LinesCard(props: {
  card: Card;
  type: CardType;
  className: string;
  fields: LineField[];
  onUpdate: (content: Card['content']) => void;
  onDelete: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.fields.map((field) => [field.key, text(props.card.content, field.key)])),
  );
  useEffect(() => {
    setValues(Object.fromEntries(props.fields.map((field) => [field.key, text(props.card.content, field.key)])));
  }, [props.card.id, props.card.content, props.fields]);

  function save(next: Record<string, string>) {
    const changed = props.fields.some((field) => next[field.key] !== text(props.card.content, field.key));
    if (!changed) return;
    props.onUpdate(Object.fromEntries(props.fields.map((field) => [field.key, next[field.key] ?? ''])));
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
                const next = { ...values, [field.key]: value };
                setValues(next);
                save(next);
              }}
            />
          ) : field.kind === 'area' ? (
            <UTextArea
              aria-label={field.label}
              rows={2}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              onBlur={() => save({ ...values })}
            />
          ) : (
            <UTextInput
              aria-label={field.label}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              onBlur={() => save({ ...values })}
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

