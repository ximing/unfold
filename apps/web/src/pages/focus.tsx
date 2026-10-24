import { observer, useService } from '@rabjs/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { SCHEMA_VERSION, getExtensions } from '@unfold/doc-schema';
import {
  type CreateRelationBody,
  type FanRelation,
  type RelationType,
} from '@unfold/dto';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { LibraryService } from '../services/library.service.js';

const SECTORS = [
  { value: 'origin', label: '来历' },
  { value: 'destination', label: '去向' },
  { value: 'contrast', label: '对照' },
  { value: 'change', label: '变化' },
] as const;

type Sector = (typeof SECTORS)[number]['value'];

const TYPES_BY_SECTOR: Record<Sector, { value: RelationType; label: string }[]> = {
  origin: [
    { value: 'evolves_from', label: '演化自' },
    { value: 'prerequisite', label: '前提' },
  ],
  destination: [
    { value: 'evolves_from', label: '演化出去' },
    { value: 'prerequisite', label: '前提' },
    { value: 'applies', label: '应用到' },
    { value: 'implements', label: '实现' },
  ],
  contrast: [
    { value: 'contrasts', label: '对比' },
    { value: 'analogous', label: '类比' },
  ],
  change: [
    { value: 'variant', label: '变体' },
    { value: 'fails_when', label: '失效' },
  ],
};

function edgeLines(relation: FanRelation): string[] {
  if (relation.type === 'evolves_from' || relation.type === 'variant') {
    return relation.whatChanged === '' ? [] : [relation.whatChanged];
  }
  if (relation.type === 'contrasts') {
    return relation.distinction === '' ? [] : [relation.distinction];
  }
  if (relation.type === 'analogous') {
    return relation.boundary === '' ? [] : [relation.boundary];
  }
  if (relation.type === 'fails_when') {
    const lines: string[] = [];
    if (relation.whatChanged !== '') lines.push(relation.whatChanged);
    if (relation.condition !== '') lines.push(relation.condition);
    return lines;
  }
  if (relation.condition !== '') return [relation.condition];
  if (relation.note !== '') return [relation.note];
  return [];
}

function relationEnds(
  sector: Sector,
  type: RelationType,
  currentId: string,
  targetId: string,
): { fromId: string; toId: string } {
  if (sector === 'origin' && type === 'prerequisite') {
    return { fromId: targetId, toId: currentId };
  }
  if (sector === 'destination' && type === 'evolves_from') {
    return { fromId: targetId, toId: currentId };
  }
  return { fromId: currentId, toId: targetId };
}

function relationBody(
  sector: Sector,
  type: RelationType,
  currentId: string,
  targetId: string,
  fields: { whatChanged: string; distinction: string; boundary: string; condition: string; note: string },
): CreateRelationBody {
  const body: CreateRelationBody = {
    ...relationEnds(sector, type, currentId, targetId),
    type,
  };
  if (type === 'evolves_from') body.whatChanged = fields.whatChanged.trim();
  if (type === 'contrasts') body.distinction = fields.distinction.trim();
  if (type === 'analogous') body.boundary = fields.boundary.trim();
  if (type === 'variant' || type === 'fails_when') {
    body.whatChanged = fields.whatChanged.trim();
    body.condition = fields.condition.trim();
  }
  if (type === 'prerequisite' || type === 'applies' || type === 'implements') {
    const note = fields.note.trim();
    if (note !== '') body.note = note;
  }
  return body;
}

const ConnectForm = observer(function ConnectForm({
  currentId,
  currentDomainId,
  onClose,
}: {
  currentId: string;
  currentDomainId: string;
  onClose: () => void;
}) {
  const library = useService(LibraryService);
  const [sector, setSector] = useState<Sector>('origin');
  const [relationType, setRelationType] = useState<RelationType>('evolves_from');
  const [domainId, setDomainId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [whatChanged, setWhatChanged] = useState('');
  const [distinction, setDistinction] = useState('');
  const [boundary, setBoundary] = useState('');
  const [condition, setCondition] = useState('');
  const [note, setNote] = useState('');
  const [crossOk, setCrossOk] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (library.domains.length > 0) return;
    void library.loadDomains();
  }, [library]);

  const typeOptions = TYPES_BY_SECTOR[sector];
  const points = domainId
    ? library.objects.filter((object) => object.domainId === domainId && object.id !== currentId)
    : [];
  const target = points.find((object) => object.id === targetId);
  const needsConfirm =
    target !== undefined && target.domainId !== currentDomainId && relationType !== 'analogous';

  function chooseSector(next: Sector) {
    setSector(next);
    const options = TYPES_BY_SECTOR[next];
    if (!options.some((item) => item.value === relationType)) {
      setRelationType(options[0].value);
    }
    setCrossOk(false);
  }

  async function onDomain(next: string) {
    setDomainId(next);
    setTargetId('');
    setCrossOk(false);
    if (next) await library.loadObjects(next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !targetId || targetId === currentId) return;
    if (!typeOptions.some((item) => item.value === relationType)) return;
    if (needsConfirm && !crossOk) return;
    setPending(true);
    try {
      const created = await library.createRelation(
        relationBody(sector, relationType, currentId, targetId, {
          whatChanged,
          distinction,
          boundary,
          condition,
          note,
        }),
      );
      if (!created) return;
      await library.loadRelations(currentId);
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="sector-form" onSubmit={(event) => void onSubmit(event)}>
      {library.error ? <p role="alert">{library.error}</p> : null}
      <label>
        方向
        <select
          value={sector}
          onChange={(event) => {
            const next = SECTORS.find((item) => item.value === event.target.value);
            if (next) chooseSector(next.value);
          }}
        >
          {SECTORS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        类型
        <select
          value={relationType}
          onChange={(event) => {
            const next = typeOptions.find((item) => item.value === event.target.value);
            if (!next) return;
            setRelationType(next.value);
            setCrossOk(false);
          }}
        >
          {typeOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        领域
        <select
          value={domainId}
          onChange={(event) => {
            void onDomain(event.target.value);
          }}
        >
          <option value="">选择领域</option>
          {library.domains.map((domain) => (
            <option key={domain.id} value={domain.id}>
              {domain.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        点
        <select
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value);
            setCrossOk(false);
          }}
        >
          <option value="">选择点</option>
          {points.map((object) => (
            <option key={object.id} value={object.id}>
              {object.canonicalName}
            </option>
          ))}
        </select>
      </label>
      {relationType === 'evolves_from' ? (
        <label>
          变化了什么
          <input value={whatChanged} onChange={(event) => setWhatChanged(event.target.value)} />
        </label>
      ) : null}
      {relationType === 'contrasts' ? (
        <label>
          区别
          <input value={distinction} onChange={(event) => setDistinction(event.target.value)} />
        </label>
      ) : null}
      {relationType === 'analogous' ? (
        <label>
          边界
          <input value={boundary} onChange={(event) => setBoundary(event.target.value)} />
        </label>
      ) : null}
      {relationType === 'variant' || relationType === 'fails_when' ? (
        <>
          <label>
            变成了什么
            <input value={whatChanged} onChange={(event) => setWhatChanged(event.target.value)} />
          </label>
          <label>
            在什么条件下
            <input value={condition} onChange={(event) => setCondition(event.target.value)} />
          </label>
        </>
      ) : null}
      {relationType === 'prerequisite' ||
      relationType === 'applies' ||
      relationType === 'implements' ? (
        <label>
          说明
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : null}
      {needsConfirm ? (
        <label className="sector-confirm">
          <input
            type="checkbox"
            checked={crossOk}
            onChange={(event) => setCrossOk(event.target.checked)}
          />
          这两个点不在同一个领域。确认仍然连接，不把它们当成同一个点
        </label>
      ) : null}
      <button type="submit" disabled={pending || !targetId || (needsConfirm && !crossOk)}>
        连接
      </button>
    </form>
  );
});

export const FocusPage = observer(function FocusPage() {
  const library = useService(LibraryService);
  const { id = '' } = useParams();
  const saveRef = useRef<() => void>(() => {});
  const [saved, setSaved] = useState(false);
  const [seed, setSeed] = useState(false);
  const [open, setOpen] = useState(false);
  const [relationsReady, setRelationsReady] = useState(false);

  const editor = useEditor({
    extensions: getExtensions(),
    content: { type: 'doc', content: [] },
    editorProps: {
      attributes: { class: 'doc-surface', 'aria-label': '块文档' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          saveRef.current();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!id || !editor) return;
    let alive = true;
    setSaved(false);
    setSeed(false);
    setOpen(false);
    setRelationsReady(false);
    library.relations = [];
    void (async () => {
      await library.loadObject(id);
      if (!alive) return;
      const docPromise = library.loadDocument(id);
      if (library.current?.id === id) {
        await library.loadRelations(id);
        if (alive) setRelationsReady(true);
      }
      const doc = await docPromise;
      if (!alive) return;
      editor.commands.setContent(doc?.content ?? { type: 'doc', content: [] }, {
        emitUpdate: false,
      });
      setSeed(doc === null || doc.plainText === '');
    })();
    return () => {
      alive = false;
    };
  }, [editor, id, library]);

  saveRef.current = () => {
    if (!editor || !id) return;
    void (async () => {
      const next = await library.saveDocument(id, {
        schemaVersion: SCHEMA_VERSION,
        content: editor.getJSON(),
        plainText: editor.getText(),
      });
      if (!next) {
        setSaved(false);
        return;
      }
      editor.commands.setContent(next.content, { emitUpdate: false });
      setSeed(next.plainText === '');
      setSaved(true);
    })();
  };

  function insert(content: Record<string, unknown>) {
    editor?.chain().focus().insertContent(content).run();
    setSeed(false);
    setSaved(false);
  }

  const current = library.current;
  if (!current || current.id !== id) {
    if (library.error === '没有这个点') {
      return (
        <main className="shell">
          <p>没有这个点</p>
        </main>
      );
    }
    return (
      <main className="shell">
        <p className="muted">正在读取…</p>
        {library.error ? <p role="alert">{library.error}</p> : null}
      </main>
    );
  }

  return (
    <main className="shell">
      <h1>{current.canonicalName}</h1>
      <p>{current.coreStatement}</p>
      <p className="muted">核心陈述 v{current.coreVersion}</p>
      {seed ? <p>这个点还是种子：只有一句话核心陈述。内容、连接、归位都后补。</p> : null}
      <div className="doc-tools">
        <button
          type="button"
          onClick={() => insert({ type: 'question', content: [{ type: 'paragraph' }] })}
        >
          疑问
        </button>
        <button
          type="button"
          onClick={() =>
            insert({
              type: 'tiered_hints',
              attrs: { collapsed: true },
              content: [{ type: 'hint_item', content: [{ type: 'paragraph' }] }],
            })
          }
        >
          分级提示
        </button>
        <button type="button" onClick={() => saveRef.current()}>
          保存
        </button>
      </div>
      {saved ? <p className="muted">已保存</p> : null}
      {library.error && library.error !== '没有这个点' && !open ? (
        <p role="alert">{library.error}</p>
      ) : null}
      <div className="doc">
        <EditorContent editor={editor} />
      </div>
      {relationsReady ? (
        <div className="sectors">
          {SECTORS.map((item) => {
            const rows = library.relations.filter((relation) => relation.sector === item.value);
            return (
              <section key={item.value} className="sector">
                <h2>{item.label}</h2>
                {rows.length === 0 ? (
                  <p>还没有</p>
                ) : (
                  <ul>
                    {rows.map((relation) => (
                      <li key={relation.id}>
                        <Link to={`/o/${relation.otherId}`}>{relation.otherName}</Link>
                        {edgeLines(relation).map((line, index) => (
                          <p key={`${relation.id}-${index}`} className="muted">
                            {line}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="muted">正在读取…</p>
      )}
      <button type="button" className="sector-open" onClick={() => setOpen((value) => !value)}>
        发起新连接
      </button>
      {open ? (
        <ConnectForm
          currentId={current.id}
          currentDomainId={current.domainId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </main>
  );
});
