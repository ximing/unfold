import type { Card, CardType } from '@unfold/dto';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';
import katex from 'katex';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CARD_TYPES, cardMeta } from '../lib/card-meta.js';
import { NoteEditor } from './note-editor.js';
import { UDateField } from './ui/date-field.js';
import { UTextArea, UTextInput } from './ui/field.js';

function text(content: Card['content'], key: string): string {
  return content[key] ?? '';
}

function FormulaPreview(props: { latex: string }) {
  if (props.latex.trim() === '') return null;
  try {
    const html = katex.renderToString(props.latex, { throwOnError: true, displayMode: true });
    return <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <p className="preview-error">公式还没法排</p>;
  }
}

function CardFrame(props: {
  type: CardType;
  className: string;
  onDelete: () => void;
  children: ReactNode;
}) {
  const meta = cardMeta(props.type);
  return (
    <article className={`kind-card ${props.className}`}>
      <header>
        <i className="kind-glyph" style={{ background: meta.hue }}>
          {meta.glyph}
        </i>
        <span className="kind-name">{meta.label}</span>
        <button type="button" onClick={props.onDelete}>
          删除
        </button>
      </header>
      {props.children}
    </article>
  );
}

function NoteCard(props: { card: Card; onUpdate: (content: Card['content']) => void; onDelete: () => void }) {
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

function CodeCard(props: { card: Card; onUpdate: (content: Card['content']) => void; onDelete: () => void }) {
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

function FormulaCard(props: { card: Card; onUpdate: (content: Card['content']) => void; onDelete: () => void }) {
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

type LineField = { key: string; label: string; kind?: 'text' | 'area' | 'date' };

function LinesCard(props: {
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

const PERSON_FIELDS: LineField[] = [
  { key: 'identity', label: '身份' },
  { key: 'note', label: '备注', kind: 'area' },
];
const EVENT_FIELDS: LineField[] = [
  { key: 'when', label: '时间', kind: 'date' },
  { key: 'where', label: '地点' },
  { key: 'summary', label: '经过', kind: 'area' },
];
const PLACE_FIELDS: LineField[] = [{ key: 'note', label: '备注', kind: 'area' }];
const PERIOD_FIELDS: LineField[] = [
  { key: 'start', label: '起', kind: 'date' },
  { key: 'end', label: '止', kind: 'date' },
  { key: 'note', label: '备注', kind: 'area' },
];
const GROUP_FIELDS: LineField[] = [{ key: 'note', label: '备注', kind: 'area' }];

function OneCard(props: { card: Card; onUpdate: (content: Card['content']) => void; onDelete: () => void }) {
  switch (props.card.type) {
    case 'note':
      return <NoteCard card={props.card} onUpdate={props.onUpdate} onDelete={props.onDelete} />;
    case 'code':
      return <CodeCard card={props.card} onUpdate={props.onUpdate} onDelete={props.onDelete} />;
    case 'formula':
      return <FormulaCard card={props.card} onUpdate={props.onUpdate} onDelete={props.onDelete} />;
    case 'person':
      return (
        <LinesCard
          card={props.card}
          type="person"
          className="kind-person"
          fields={PERSON_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'event':
      return (
        <LinesCard
          card={props.card}
          type="event"
          className="kind-event"
          fields={EVENT_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'place':
      return (
        <LinesCard
          card={props.card}
          type="place"
          className="kind-place"
          fields={PLACE_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'period':
      return (
        <LinesCard
          card={props.card}
          type="period"
          className="kind-period"
          fields={PERIOD_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    case 'group':
      return (
        <LinesCard
          card={props.card}
          type="group"
          className="kind-group"
          fields={GROUP_FIELDS}
          onUpdate={props.onUpdate}
          onDelete={props.onDelete}
        />
      );
    default:
      return null;
  }
}

export function CardStack(props: {
  cards: Card[];
  onCreate: (type: CardType) => void;
  onUpdate: (id: string, content: Card['content']) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="card-stack">
      <div className="card-add">
        {CARD_TYPES.map((type) => {
          const meta = cardMeta(type);
          return (
            <button key={type} type="button" className="card-add-btn" onClick={() => props.onCreate(type)}>
              <i style={{ background: meta.hue }}>{meta.glyph}</i>
              {meta.label}
            </button>
          );
        })}
      </div>
      {props.cards.map((card) => (
        <OneCard
          key={card.id}
          card={card}
          onUpdate={(content) => props.onUpdate(card.id, content)}
          onDelete={() => props.onDelete(card.id)}
        />
      ))}
    </div>
  );
}
