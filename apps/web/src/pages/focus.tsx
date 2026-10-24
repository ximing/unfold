import { observer, useService } from '@rabjs/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { SCHEMA_VERSION, getExtensions } from '@unfold/doc-schema';
import {
  type CreateRelationBody,
  type FanRelation,
  type CapabilityKind,
  type ObjectSummary,
  type RelationType,
} from '@unfold/dto';
import { type FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { LibraryService } from '../services/library.service.js';
import { PlacePanel } from './place-panel.js';
import { SuggestionTray } from './suggestion-tray.js';

const SECTORS = [
  { value: 'origin', label: '来历' },
  { value: 'destination', label: '去向' },
  { value: 'contrast', label: '对照' },
  { value: 'change', label: '变化' },
] as const;

type Sector = (typeof SECTORS)[number]['value'];

const TYPE_LABEL: Record<ObjectSummary['type'], string> = {
  concept: '概念',
  principle: '原则',
  method: '方法',
  model: '模型',
  problem: '问题',
};

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

function GraphProjection({
  graph,
  currentId,
}: {
  graph: LibraryService['graph'];
  currentId: string;
}) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const focus = nodes.find((node) => node.id === currentId);
  const neighbors = nodes.filter((node) => node.id !== currentId);
  return (
    <>
      {edges.length === 0 ? (
        <p className="muted">这个点还没有已接受的连接。接受右侧托盘的建议，或从扇区发起一条，图上才会长出来。</p>
      ) : null}
      <svg className="graph" viewBox="0 0 800 560" role="img" aria-label="以焦点为中心的局部图">
        <g transform="translate(400 280)">
          {edges.map((edge) => {
            const target = nodes.find((node) => node.id === edge.toId);
            if (!target) return null;
            return (
              <g key={`${edge.fromId}-${edge.toId}`}>
                <line x1={0} y1={0} x2={target.x} y2={target.y} stroke="#1d4e8f" strokeWidth={1} />
                <text className="edge" x={target.x / 2} y={target.y / 2 - 6}>
                  {edge.label}
                </text>
              </g>
            );
          })}
          {neighbors.map((node) => {
            const core =
              node.coreStatement.length > 18 ? `${node.coreStatement.slice(0, 18)}…` : node.coreStatement;
            return (
              <a key={node.id} href={`/o/${node.id}?proj=graph`}>
                <text x={node.x} y={node.y}>
                  {node.canonicalName}
                </text>
                <text x={node.x} y={node.y + 16}>
                  {TYPE_LABEL[node.type]}
                </text>
                <text x={node.x} y={node.y + 32}>
                  {core}
                </text>
              </a>
            );
          })}
          {focus ? (
            <g>
              <rect x={-70} y={-22} width={140} height={44} fill="none" stroke="#1a2230" strokeWidth={2} />
              <text x={-60} y={4} fontWeight={700}>
                {focus.canonicalName}
              </text>
            </g>
          ) : null}
        </g>
      </svg>
      {graph?.truncated ? <p className="muted">邻居超过 50，这里只画前 50 个。</p> : null}
      <p className="muted">只画一跳邻居，按扇区方位摆放，上限 50。点任意节点换焦点。图是导航，不是装饰画。</p>
    </>
  );
}

function ChainProjection({
  chains,
  currentId,
}: {
  chains: LibraryService['chains'];
  currentId: string;
}) {
  if (chains.length === 0) {
    return (
      <p className="muted">经过这个点的演化链或变体链还没有成形。链是关系的线性投影：evolves_from 和 variant 连起来，边上写条件变化。</p>
    );
  }
  return (
    <>
      {chains.map((chain, chainIndex) => (
        <div key={`${chain.type}-${chainIndex}`}>
          <h3>{chain.type === 'evolves_from' ? '演化链' : '变体链'}</h3>
          <div className="chainflow">
            {chain.nodes.map((node, index) => {
              const edge = index > 0 ? chain.edges[index - 1] : undefined;
              return (
                <Fragment key={`${node.id}-${index}`}>
                  {edge ? (
                    <span className="chain-edge">
                      <span className="arrow">→</span>
                      {edge.whatChanged}
                    </span>
                  ) : null}
                  <Link
                    to={`/o/${node.id}`}
                    className={node.id === currentId ? 'chain-node now' : 'chain-node'}
                  >
                    <span className="nm">{node.canonicalName}</span>
                    <small>{node.coreStatement}</small>
                  </Link>
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
      <p className="muted">链不另存数据。边上的话逐字来自关系上的 what_changed。断开的链说明中间还缺一条演化关系。</p>
    </>
  );
}

function ContrastProjection({
  current,
  relations,
}: {
  current: ObjectSummary;
  relations: FanRelation[];
}) {
  const rows = relations.filter((relation) => relation.sector === 'contrast');
  if (rows.length === 0) {
    return <p className="muted">这个点还没有对比或类比关系。</p>;
  }
  return (
    <>
      {rows.map((relation) => (
        <Fragment key={relation.id}>
          <div className="split">
            <article>
              <p className="muted">
                {TYPE_LABEL[current.type]} · {current.domainName}
              </p>
              <h2>{current.canonicalName}</h2>
              <p>{current.coreStatement}</p>
            </article>
            <article>
              <h2>{relation.otherName}</h2>
              <p>{relation.otherCore}</p>
              <p>
                <Link to={`/o/${relation.otherId}`}>打开这个点</Link>
              </p>
            </article>
          </div>
          {relation.type === 'analogous' ? (
            <div className="boundary">
              <h2>边界（必填）</h2>
              <p>{relation.boundary}</p>
              <p className="muted">类比必须写清边界。两个点保持独立，这里没有合并入口。</p>
            </div>
          ) : null}
          {relation.type === 'contrasts' ? (
            <table>
              <thead>
                <tr>
                  <th />
                  <th>{current.canonicalName}</th>
                  <th>{relation.otherName}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>核心陈述</th>
                  <td>{current.coreStatement}</td>
                  <td>{relation.otherCore}</td>
                </tr>
                <tr>
                  <th>区别</th>
                  <td>{relation.distinction}</td>
                  <td>{relation.distinction}</td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </Fragment>
      ))}
    </>
  );
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

const CAPABILITY_KIND: Record<CapabilityKind, string> = {
  explain: '解释',
  derive: '推导',
  discriminate: '辨别',
  vary: '变体',
  counter: '反例',
  implement: '实现',
  transfer: '迁移',
  tradeoff: '取舍',
};

function isCapabilityKind(value: string): value is CapabilityKind {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_KIND, value);
}

function hintThresholdFrom(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 3;
  return parsed;
}

const CapabilityProjection = observer(function CapabilityProjection({
  objectId,
}: {
  objectId: string;
}) {
  const library = useService(LibraryService);
  const [statement, setStatement] = useState('');
  const [kind, setKind] = useState<CapabilityKind>('explain');
  const [hintLines, setHintLines] = useState('');
  const [threshold, setThreshold] = useState('3');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = statement.trim();
    if (pending || trimmed === '') return;
    setPending(true);
    try {
      const created = await library.createCapability({
        statement: trimmed,
        kind,
        primaryObjectId: objectId,
        hints: hintLines.split('\n').filter((line) => line.trim() !== ''),
        hintThreshold: hintThresholdFrom(threshold),
      });
      if (!created) return;
      setStatement('');
      setKind('explain');
      setHintLines('');
      setThreshold('3');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>能力</h2>
      {library.capabilities.length === 0 ? (
        <p>还没有能力。</p>
      ) : (
        <ul>
          {library.capabilities.map((cap) => (
            <li key={cap.id}>
              <p>
                <span className="muted">{CAPABILITY_KIND[cap.kind]}</span> {cap.statement}
              </p>
              {cap.hints.length > 0 ? (
                <p className="muted">
                  {cap.hints.length} 级，练习时逐级展开。提示到第 {cap.hintThreshold} 级后不能记独立完成。
                </p>
              ) : null}
              {cap.practiceLocked ? (
                <p>{cap.practiceLockMessage}</p>
              ) : (
                <p>
                  <Link to={`/practice/${cap.id}`}>开始做</Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void onSubmit(event)}>
        <input
          aria-label="能做什么"
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
        />
        <select
          aria-label="能力种类"
          value={kind}
          onChange={(event) => {
            const next = event.target.value;
            if (isCapabilityKind(next)) setKind(next);
          }}
        >
          {(Object.keys(CAPABILITY_KIND) as CapabilityKind[]).map((value) => (
            <option key={value} value={value}>
              {CAPABILITY_KIND[value]}
            </option>
          ))}
        </select>
        <textarea
          aria-label="提示，一行一级"
          value={hintLines}
          onChange={(event) => setHintLines(event.target.value)}
        />
        <input
          type="number"
          aria-label="独立完成锁定级数"
          min={1}
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
        />
        <button type="submit" disabled={pending || statement.trim() === ''}>
          记下这条能力
        </button>
      </form>
      <p className="muted">能力是最小学习单元。开放回答自评，提示到第 3 级不能记独立完成。不出现掌握度百分比。</p>
    </section>
  );
});

export const FocusPage = observer(function FocusPage() {
  const library = useService(LibraryService);
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const proj = searchParams.get('proj');
  const showGraph = proj === 'graph';
  const showChain = proj === 'chain';
  const showContrast = proj === 'contrast';
  const showCaps = proj === 'caps';
  const saveRef = useRef<() => void>(() => {});
  const [saved, setSaved] = useState(false);
  const [noSuggestion, setNoSuggestion] = useState(false);
  const [seed, setSeed] = useState(false);
  const [open, setOpen] = useState(false);
  const [relationsReady, setRelationsReady] = useState(false);
  const [chainReadyId, setChainReadyId] = useState('');
  const [graphReadyId, setGraphReadyId] = useState('');
  const [capsReadyId, setCapsReadyId] = useState('');
  const [editingStatement, setEditingStatement] = useState(false);
  const [statementDraft, setStatementDraft] = useState('');
  const [savingStatement, setSavingStatement] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    setNoSuggestion(false);
    setSeed(false);
    setOpen(false);
    setRelationsReady(false);
    setEditingStatement(false);
    setStatementDraft('');
    setSavingStatement(false);
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

  useEffect(() => {
    if (!showChain || !id) return;
    let alive = true;
    void library.loadChain(id).then(() => {
      if (alive) setChainReadyId(id);
    });
    return () => {
      alive = false;
    };
  }, [showChain, id, library]);

  useEffect(() => {
    if (!showGraph || !id) return;
    let alive = true;
    void library.loadGraph(id).then(() => {
      if (alive) setGraphReadyId(id);
    });
    return () => {
      alive = false;
    };
  }, [showGraph, id, library]);

  useEffect(() => {
    if (!showCaps || !id) return;
    let alive = true;
    void library.loadCapabilities(id).then(() => {
      if (alive) setCapsReadyId(id);
    });
    return () => {
      alive = false;
    };
  }, [showCaps, id, library]);

  useEffect(() => {
    if (library.suggestions.length > 0 || library.suggestionNotice !== '') {
      setNoSuggestion(false);
    }
  }, [library, library.suggestions.length, library.suggestionNotice]);

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
      await library.loadSuggestions(id);
      setNoSuggestion(library.suggestions.length === 0 && library.suggestionNotice === '');
    })();
  };

  function insert(content: Record<string, unknown>) {
    editor?.chain().focus().insertContent(content).run();
    setSeed(false);
    setSaved(false);
  }

  function selectProjection(nextProj: 'chain' | 'contrast' | 'caps' | 'graph' | null) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextProj === null) next.delete('proj');
      else next.set('proj', nextProj);
      return next;
    });
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
      <button
        type="button"
        onClick={() => {
          if (!editingStatement) setStatementDraft(current.coreStatement);
          setEditingStatement(true);
        }}
      >
        修改核心陈述
      </button>
      {editingStatement ? (
        <>
          <textarea
            aria-label="核心陈述"
            value={statementDraft}
            onChange={(event) => setStatementDraft(event.target.value)}
          />
          <button
            type="button"
            disabled={savingStatement}
            onClick={() => {
              if (savingStatement) return;
              setSavingStatement(true);
              void (async () => {
                try {
                  const summary = await library.updateObject(id, {
                    coreStatement: statementDraft,
                  });
                  if (summary) setEditingStatement(false);
                } finally {
                  setSavingStatement(false);
                }
              })();
            }}
          >
            保存
          </button>
          {library.error ? <p role="alert">{library.error}</p> : null}
        </>
      ) : null}
      <button
        type="button"
        disabled={deleting}
        onClick={() => {
          if (deleting) return;
          setDeleting(true);
          void (async () => {
            try {
              const ok = await library.deleteObject(id);
              if (ok) navigate('/today');
            } finally {
              setDeleting(false);
            }
          })();
        }}
      >
        删除这个点
      </button>
      <div className="views" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!showGraph && !showChain && !showContrast && !showCaps}
          onClick={() => selectProjection(null)}
        >
          内容
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showGraph}
          onClick={() => selectProjection('graph')}
        >
          图
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showChain}
          onClick={() => selectProjection('chain')}
        >
          链
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showContrast}
          onClick={() => selectProjection('contrast')}
        >
          对比
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showCaps}
          onClick={() => selectProjection('caps')}
        >
          能力
        </button>
      </div>
      {seed ? <p>这个点还是种子：只有一句话核心陈述。内容、连接、归位都后补。</p> : null}
      {showGraph ? (
        graphReadyId === id ? (
          <>
            {library.error && library.error !== '没有这个点' && !open ? (
              <p role="alert">{library.error}</p>
            ) : null}
            <GraphProjection graph={library.graph} currentId={current.id} />
          </>
        ) : (
          <p className="muted">正在读取…</p>
        )
      ) : showChain ? (
        chainReadyId === id ? (
          <>
            {library.error && library.error !== '没有这个点' && !open ? (
              <p role="alert">{library.error}</p>
            ) : null}
            <ChainProjection chains={library.chains} currentId={current.id} />
          </>
        ) : (
          <p className="muted">正在读取…</p>
        )
      ) : showContrast ? (
        relationsReady ? (
          <>
            {library.error && library.error !== '没有这个点' && !open ? (
              <p role="alert">{library.error}</p>
            ) : null}
            <ContrastProjection current={current} relations={library.relations} />
          </>
        ) : (
          <p className="muted">正在读取…</p>
        )
      ) : showCaps ? (
        capsReadyId === id ? (
          <>
            {library.error && library.error !== '没有这个点' && !open ? (
              <p role="alert">{library.error}</p>
            ) : null}
            <CapabilityProjection objectId={id} />
          </>
        ) : (
          <p className="muted">正在读取…</p>
        )
      ) : (
        <>
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
            <button
              type="button"
              onClick={() =>
                insert({
                  type: 'algo_problem',
                  attrs: { statement: '', constraints: '', examples: '', complexity: '' },
                })
              }
            >
              算法题
            </button>
            <button
              type="button"
              onClick={() =>
                insert({
                  type: 'theorem',
                  attrs: { proposition: '', condition: '', proof: '', corollary: '' },
                })
              }
            >
              定理
            </button>
            <button
              type="button"
              onClick={() =>
                insert({
                  type: 'lang_pattern',
                  attrs: { pattern: '', example: '', contrast: '', confusion: '' },
                })
              }
            >
              句型
            </button>
            <button
              type="button"
              onClick={() => insert({ type: 'blockMath', attrs: { latex: '' } })}
            >
              公式
            </button>
            <button type="button" onClick={() => saveRef.current()}>
              保存
            </button>
          </div>
          {saved ? <p className="muted">已保存</p> : null}
          {noSuggestion ? <p className="muted">这次没有连接建议</p> : null}
          {library.error && library.error !== '没有这个点' && !open ? (
            <p role="alert">{library.error}</p>
          ) : null}
          <div className="doc">
            <EditorContent editor={editor} />
          </div>
        </>
      )}
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
                {item.value === 'contrast' && rows.length > 0 ? (
                  <button type="button" onClick={() => selectProjection('contrast')}>
                    并排看
                  </button>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="muted">正在读取…</p>
      )}
      <SuggestionTray objectId={current.id} />
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
      <PlacePanel objectId={current.id} domainId={current.domainId} />
    </main>
  );
});
