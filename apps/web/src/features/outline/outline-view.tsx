import { observer, useService } from '@rabjs/react';
import { indent, moveSibling, outdent, type DuplicateNode } from '@unfold/dto';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router';
import { UButton } from '../../shared/ui/button/button.js';
import { LibraryService } from '../library/library.service.js';
import { AddMemberDialog } from './add-member-dialog.js';
import type { OutlineSession } from './outline-session.js';
import { readOutlineReturn, writeOutlineReturn } from './outline-return.js';
import { expandedWithAncestors, outlineItems, visibleOutlineRows } from './outline-tree.js';
import './outline-view.css';

type Draft = { parentId: string | null; afterNodeId: string | null; value: string };
type NameEdit = { nodeId: string; value: string };
type MoveAction = 'indent' | 'outdent' | 'up' | 'down';

/** 新建后的重复提示：创建的名字 + 可能重复的已有点。 */
export type CreateNotice = { name: string; duplicates: DuplicateNode[] };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return true;
  }
  return target.closest('input, textarea, .tiptap, [contenteditable="true"]') !== null;
}

export function CreateNoticeBanner(props: {
  notice: CreateNotice;
  onLocate: (nodeId: string) => void;
  onClose: () => void;
}) {
  return (
    <p className="outline-notice" role="status">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M8 5.5v3.2" />
        <circle cx="8" cy="11.2" r="0.4" fill="currentColor" />
        <path d="M7 2.9 1.9 12a1 1 0 0 0 .87 1.5h10.46A1 1 0 0 0 14.1 12L9 2.9a1.15 1.15 0 0 0-2 0Z" />
      </svg>
      <span>
        已创建「{props.notice.name}」。可能与已有点重复：
        {props.notice.duplicates.map((item, index) => (
          <span key={item.id}>
            {index > 0 ? '、' : ''}
            <button type="button" className="outline-notice-link" onClick={() => props.onLocate(item.id)}>
              {item.name}
            </button>
            （{item.collections.length > 0 ? item.collections.map((entry) => entry.title).join('、') : '未归入合集'}）
          </span>
        ))}
      </span>
      <button type="button" className="outline-notice-close" aria-label="知道了" onClick={props.onClose}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </p>
  );
}

export const OutlineView = observer(function OutlineView(props: {
  collectionId: string;
  selectedId: string | null;
  revealId: string | null;
  entry: 'open' | 'switch';
  /** 加入已有点之后定位。tick 变化才滚一次，不改结构。 */
  focus: { id: string; tick: number } | null;
  session: OutlineSession;
  structure: boolean;
  onStructureChange: (next: boolean) => void;
  /** undefined 不打开；null 加到根；否则加到该点下面。 */
  adding: string | null | undefined;
  onAddingChange: (next: string | null | undefined) => void;
  /** 画板新建带过来的重复提示，大纲模式下在列里展示。 */
  createNotice: CreateNotice | null;
  onDismissNotice: () => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onAskRemove: (id: string) => void;
}) {
  const library = useService(LibraryService);
  const nodes = library.graphId === props.collectionId ? library.graph.nodes : [];
  const inclusions = library.graphId === props.collectionId ? library.graph.inclusions : [];
  const structure = props.structure;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edit, setEdit] = useState<NameEdit | null>(null);
  const [notice, setNotice] = useState<CreateNotice | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef(expanded);
  const selectedRef = useRef(props.selectedId);
  const onSelectRef = useRef(props.onSelect);
  const revealedRef = useRef<string | null>(null);
  const revealFrameRef = useRef(0);
  expandedRef.current = expanded;
  selectedRef.current = props.selectedId;
  onSelectRef.current = props.onSelect;

  useEffect(() => {
    const collectionId = props.collectionId;
    return () => {
      writeOutlineReturn(collectionId, {
        expanded: [...expandedRef.current],
        selectedId: selectedRef.current,
        scrollTop: scrollerRef.current?.scrollTop ?? 0,
      });
    };
  }, [props.collectionId]);

  useEffect(() => {
    if (library.graphId !== props.collectionId) return;
    const saved = props.entry === 'open' ? readOutlineReturn(props.collectionId) : null;
    let next = new Set(saved?.expanded ?? []);
    const reveal = props.entry === 'switch' ? props.revealId : (props.revealId ?? saved?.selectedId ?? null);
    if (reveal) next = expandedWithAncestors(next, nodes, reveal);
    setExpanded(next);
    if (props.entry === 'open' && !props.revealId && saved?.selectedId) props.onSelect(saved.selectedId);
    const scrollTop = props.entry === 'open' && !props.revealId ? (saved?.scrollTop ?? 0) : null;
    const revealRow = reveal;
    requestAnimationFrame(() => {
      if (scrollTop !== null && scrollerRef.current) scrollerRef.current.scrollTop = scrollTop;
      if (revealRow) document.getElementById(`outline-row-${revealRow}`)?.scrollIntoView({ block: 'nearest' });
    });
    // 只在这份图第一次就绪时恢复。之后的改动不要把用户折回去的项再打开。
  }, [props.collectionId, library.graphId]);

  useEffect(() => {
    const revealId = props.revealId;
    if (!revealId) {
      revealedRef.current = null;
      return;
    }
    if (library.graphId !== props.collectionId) return;
    const graphNodes = library.graph.nodes;
    if (!graphNodes.some((node) => node.id === revealId)) return;
    if (revealedRef.current === revealId) return;
    revealedRef.current = revealId;
    setExpanded((prev) => expandedWithAncestors(prev, graphNodes, revealId));
    onSelectRef.current(revealId);
    cancelAnimationFrame(revealFrameRef.current);
    revealFrameRef.current = requestAnimationFrame(() => {
      document.getElementById(`outline-row-${revealId}`)?.scrollIntoView({ block: 'nearest' });
    });
    // 搜索或 ?node= 后到时只补祖先。点还没进图就不记成已处理。
  }, [props.revealId, props.collectionId, library.graphId, library.graph.nodes]);

  useEffect(() => {
    if (!props.focus || library.graphId !== props.collectionId) return;
    locate(props.focus.id);
  }, [props.focus?.tick, props.collectionId, library.graphId]);

  useEffect(() => {
    if (!structure) return;
    const frame = requestAnimationFrame(() => treeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('.modal-wrap, .overlay, .addm-overlay')) return;
      event.preventDefault();
      props.onStructureChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [structure]);

  const rows = visibleOutlineRows(nodes, expanded);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  function locate(nodeId: string) {
    setExpanded((prev) => expandedWithAncestors(prev, library.graph.nodes, nodeId));
    props.onSelect(nodeId);
    requestAnimationFrame(() => {
      document.getElementById(`outline-row-${nodeId}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function move(nodeId: string, action: MoveAction) {
    const current = outlineItems(library.graph.nodes);
    const next =
      action === 'indent'
        ? indent(current, nodeId)
        : action === 'outdent'
          ? outdent(current, nodeId)
          : moveSibling(current, nodeId, action === 'up' ? 'up' : 'down');
    if (action === 'indent') {
      const parentId = next.find((item) => item.nodeId === nodeId)?.parentId;
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
    }
    await props.session.applyStructure(next);
  }

  function moveSelection(delta: number) {
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.nodeId === props.selectedId);
    const next = rows[index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (next) props.onSelect(next.nodeId);
  }

  function onTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isTypingTarget(event.target)) return;
    if (!structure) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter' && props.selectedId) {
        event.preventDefault();
        props.onOpen(props.selectedId);
      }
      return;
    }
    if (!props.selectedId) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      void move(props.selectedId, event.shiftKey ? 'outdent' : 'indent');
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      void move(props.selectedId, event.key === 'ArrowUp' ? 'up' : 'down');
    }
  }

  async function commitEdit() {
    if (!edit) return;
    const node = byId.get(edit.nodeId);
    if (!node) return;
    const name = edit.value.trim();
    if (name === '') return;
    if (name !== node.name) {
      const ok = await props.session.track(async () => ((await library.renameNode(node.id, name)) ? true : null));
      if (!ok) return;
    }
    setEdit(null);
    setDraft({ parentId: node.parentId, afterNodeId: node.id, value: '' });
  }

  async function createAt(parentId: string | null, afterNodeId: string | null, raw: string) {
    const name = raw.trim();
    if (name === '') return;
    setNotice(null);
    const created = await props.session.track(() =>
      library.createNode(props.collectionId, name, { parentId, afterNodeId: afterNodeId ?? undefined }),
    );
    if (!created) {
      setDraft({ parentId, afterNodeId, value: raw });
      return;
    }
    if (created.duplicates.length > 0) {
      setNotice({ name: created.name, duplicates: created.duplicates });
    }
    props.onSelect(created.id);
    setDraft({ parentId: created.parentId, afterNodeId: created.id, value: '' });
  }

  async function commitDraft() {
    if (!draft) return;
    await createAt(draft.parentId, draft.afterNodeId, draft.value);
  }

  function renderDraft(parentId: string | null, afterNodeId: string | null, depth: number) {
    if (!draft || draft.parentId !== parentId || draft.afterNodeId !== afterNodeId) return null;
    return (
      <div
        key="draft"
        className="outline-row"
        role="treeitem"
        aria-selected="true"
        aria-level={depth}
        style={{ paddingLeft: 8 + (depth - 1) * 18 }}
      >
        <span className="outline-fold-spacer" />
        <input
          className="outline-draft"
          aria-label="新的一行"
          value={draft.value}
          placeholder="名称"
          onChange={(event) => setDraft({ ...draft, value: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitDraft();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
            }
          }}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div className="outline-shell">
      <div className="outline-main" ref={scrollerRef}>
        <div className="outline-col">
          {notice ? (
            <CreateNoticeBanner notice={notice} onLocate={locate} onClose={() => setNotice(null)} />
          ) : null}
          {props.createNotice ? (
            <CreateNoticeBanner notice={props.createNotice} onLocate={locate} onClose={props.onDismissNotice} />
          ) : null}
          {nodes.length === 0 && !draft ? (
            <div className="outline-empty-card">
              <h2>先列一个主题或章节</h2>
              <p>回车连续添加，Tab 降一级；也可以直接放入以前建过的点</p>
              <form
                className="outline-empty-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = event.currentTarget.elements.namedItem('root-name');
                  const name = input instanceof HTMLInputElement ? input.value : '';
                  void createAt(null, null, name);
                }}
              >
                <input
                  name="root-name"
                  aria-label="主题或章节"
                  placeholder="名称"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void createAt(null, null, event.currentTarget.value);
                  }}
                />
                <UButton onClick={() => props.onAddingChange(null)}>加入已有点</UButton>
              </form>
            </div>
          ) : null}
          {nodes.length > 0 || draft ? (
            <div className="outline-group">
              <div
                ref={treeRef}
                className={structure ? 'outline-tree structure' : 'outline-tree'}
                role="tree"
                aria-label="大纲"
                tabIndex={0}
                onKeyDown={onTreeKeyDown}
              >
                {draft && draft.afterNodeId === null && draft.parentId === null && nodes.length === 0
                  ? renderDraft(null, null, 1)
                  : null}
                {rows.map((row) => {
                  const node = byId.get(row.nodeId);
                  if (!node) return null;
                  const selected = props.selectedId === node.id;
                  const editing = edit?.nodeId === node.id;
                  return (
                    <div key={node.id}>
                      <div
                        id={`outline-row-${node.id}`}
                        role="treeitem"
                        aria-selected={selected}
                        aria-level={row.depth}
                        className="outline-row"
                        style={{ paddingLeft: 8 + (row.depth - 1) * 18 }}
                        onClick={() => props.onSelect(node.id)}
                      >
                        <span className="outline-grip" aria-hidden>
                          ⠿
                        </span>
                        {row.hasChildren ? (
                          <button
                            type="button"
                            className="outline-fold"
                            aria-expanded={expanded.has(node.id)}
                            aria-label={expanded.has(node.id) ? '折叠' : '展开'}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(node.id)) next.delete(node.id);
                                else next.add(node.id);
                                return next;
                              });
                            }}
                          >
                            {expanded.has(node.id) ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span className="outline-fold-spacer" />
                        )}
                        {editing ? (
                          <input
                            className="outline-edit"
                            aria-label="名称"
                            value={edit.value}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setEdit({ nodeId: node.id, value: event.target.value })}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void commitEdit();
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setEdit(null);
                              }
                            }}
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            className="outline-name"
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              setDraft(null);
                              setEdit({ nodeId: node.id, value: node.name });
                            }}
                          >
                            {node.name}
                          </button>
                        )}
                        {node.cardCount > 0 ? <span className="outline-count">{node.cardCount}</span> : null}
                        {node.kind === 'image' ? <span className="outline-badge">图片</span> : null}
                        <details
                          className="outline-menu"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onSelect(node.id);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <summary aria-label="行菜单">
                            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                              <circle cx="3" cy="8" r="1.3" />
                              <circle cx="8" cy="8" r="1.3" />
                              <circle cx="13" cy="8" r="1.3" />
                            </svg>
                          </summary>
                          <div className="outline-menu-pop">
                            <button type="button" onClick={() => void move(node.id, 'outdent')}>
                              升一级
                            </button>
                            <button type="button" onClick={() => void move(node.id, 'indent')}>
                              降一级
                            </button>
                            <button type="button" onClick={() => void move(node.id, 'up')}>
                              上移
                            </button>
                            <button type="button" onClick={() => void move(node.id, 'down')}>
                              下移
                            </button>
                            <button type="button" onClick={() => props.onAddingChange(node.id)}>
                              加入已有点
                            </button>
                            <button type="button" onClick={() => props.onAskRemove(node.id)}>
                              移出当前合集
                            </button>
                          </div>
                        </details>
                        <button
                          type="button"
                          className="outline-go"
                          aria-label="打开"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onOpen(node.id);
                          }}
                        >
                          ›
                        </button>
                      </div>
                      {renderDraft(node.parentId, node.id, row.depth)}
                    </div>
                  );
                })}
                {draft && draft.afterNodeId === null && draft.parentId === null && nodes.length > 0
                  ? renderDraft(null, null, 1)
                  : null}
              </div>
              {nodes.length > 0 ? (
                <button
                  type="button"
                  className="outline-row-add"
                  onClick={() => {
                    setEdit(null);
                    setDraft({ parentId: null, afterNodeId: null, value: '' });
                  }}
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M8 3.5v9M3.5 8h9" />
                  </svg>
                  加一行
                </button>
              ) : null}
            </div>
          ) : null}
          {structure ? (
            <div className="outline-hintbar">
              <span>
                <kbd>Tab</kbd>降一级
              </span>
              <span>
                <kbd>⇧ Tab</kbd>升一级
              </span>
              <span>
                <kbd>↑ ↓</kbd>前后移动
              </span>
              <button type="button" className="outline-hint-done" onClick={() => props.onStructureChange(false)}>
                完成 Esc
              </button>
            </div>
          ) : null}
          {inclusions.length > 0 ? (
            <div className="outline-group">
              <div className="outline-group-head">
                <b>子合集</b>
                <span>{inclusions.length}</span>
              </div>
              {inclusions.map((item) => (
                <Link key={item.childId} className="outline-row-link" to={`/c/${item.childId}`}>
                  {item.title}
                  <span className="outline-go">›</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {props.adding !== undefined ? (
        <AddMemberDialog
          collectionId={props.collectionId}
          parentId={props.adding}
          onClose={() => props.onAddingChange(undefined)}
          onDone={(status, nodeId) => {
            if (status === 'exists' || status === 'joined') locate(nodeId);
          }}
        />
      ) : null}
    </div>
  );
});
