import { observer, useService } from '@rabjs/react';
import type { Card, CardType, RichDoc } from '@unfold/dto';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { PanelShell } from '../../shared/panel/panel-shell.js';
import { createHandoff } from '../../shared/save/handoff.js';
import { noteDraft } from '../../shared/save/save-bus.js';
import { takeServerText } from '../../shared/save/server-text.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';
import { NameField } from '../../shared/name-field/name-field.js';
import { UButton } from '../../shared/ui/button/button.js';
import { UTextArea } from '../../shared/ui/field/field.js';
import { useAskDelete } from '../../shared/ui/modal/delete-key.js';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { USelect } from '../../shared/ui/select/select.js';
import { IconPlus } from '../../shared/ui/icons/icons.js';
import { toast } from '../../shared/ui/toast/toast.js';
import { CARD_TYPES, cardMeta } from '../cards/card-meta.js';
import { CardStack } from '../cards/card-stack.js';
import { emptyCard } from '../cards/empty-card.js';
import { EXPLAIN_TEMPLATES, TEMPLATE_HINTS, explainTemplateDoc, type ExplainTemplateId } from '../cards/explain-template.js';
import { docFromClipboardData, docWithImages } from '../cards/quick-capture.js';
import { filesFromTransfer, isFileDrag } from '../cards/rich/upload.js';
import { AddMemberDialog } from '../outline/add-member-dialog.js';
import { imageFileIssue } from '../board/image-intake.js';
import { apiSend, errorMessage } from '../library/api.js';
import { LibraryService } from '../library/library.service.js';
import {
  NODE_PANEL_CANVAS_MIN,
  NODE_PANEL_WIDTH_KEY,
  NODE_PANEL_WIDTH_MAX,
  NODE_PANEL_WIDTH_MIN,
  applyPanelWidth,
  readPanelWidth,
} from './panel-width.js';
import './node-panel.css';

function readStoredWidth(): number {
  try {
    return readPanelWidth(localStorage.getItem(NODE_PANEL_WIDTH_KEY));
  } catch {
    return readPanelWidth(null);
  }
}

function clampPreferred(width: number): number {
  return Math.min(NODE_PANEL_WIDTH_MAX, Math.max(NODE_PANEL_WIDTH_MIN, width));
}

function useNodePanelWidth() {
  const rootRef = useRef<HTMLElement>(null);
  const [preferred, setPreferred] = useState<number>(readStoredWidth);
  const [frameWidth, setFrameWidth] = useState(0);
  const preferredRef = useRef(preferred);
  const frameWidthRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startPreferred: number;
    startShown: number;
  } | null>(null);

  useLayoutEffect(() => {
    const frame = rootRef.current?.offsetParent;
    if (!(frame instanceof HTMLElement)) return;
    const measure = () => {
      frameWidthRef.current = frame.clientWidth;
      setFrameWidth(frame.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const delta = drag.startX - event.clientX;
      // 往窄拖从当时的显示宽度起算，避免窗口已经压住面板时，手没看见变化就把偏好改小。
      const basis = delta < 0 ? drag.startShown : drag.startPreferred;
      const next = clampPreferred(Math.round(basis + delta));
      preferredRef.current = next;
      setPreferred(next);
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.stopPropagation();
      dragRef.current = null;
      if (frameWidthRef.current - NODE_PANEL_CANVAS_MIN < NODE_PANEL_WIDTH_MIN) {
        const stored = readStoredWidth();
        preferredRef.current = stored;
        setPreferred(stored);
        return;
      }
      const next = preferredRef.current;
      if (next < NODE_PANEL_WIDTH_MIN || next > NODE_PANEL_WIDTH_MAX) return;
      try {
        localStorage.setItem(NODE_PANEL_WIDTH_KEY, String(next));
      } catch {
        // 存不了时只保留这次显示
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startPreferred = preferredRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPreferred,
      startShown: applyPanelWidth(startPreferred, frameWidthRef.current),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return { rootRef, width: applyPanelWidth(preferred, frameWidth), onResizePointerDown };
}

const MORE_TYPES = CARD_TYPES.filter((type) => type !== 'rich');

export const NodePanel = observer(function NodePanel(props: {
  collectionId: string | null;
  nodeId: string;
  onLeave: () => void;
  onTouched: () => void;
  focusCardId?: string | null;
  /** 移出当前合集。没有合集时不显示 */
  onAskRemove?: () => void;
  /** 加入已有点之后，让大纲展开祖先并选中，不改结构 */
  onLocated?: (nodeId: string) => void;
  /** 非 0 时打开删除确认。右键菜单和检查器共用这一条 */
  askRemove?: number;
}) {
  const library = useService(LibraryService);
  const panel = useNodePanelWidth();
  const faceFileRef = useRef<HTMLInputElement>(null);
  const [targetCollection, setTargetCollection] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [veil, setVeil] = useState(false);
  const tplPopRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const freshCardId = useRef<string | null>(null);
  const detail = library.nodeDetail?.id === props.nodeId ? library.nodeDetail : null;
  useAskDelete(() => setConfirm(true));
  useEffect(() => {
    if (!props.askRemove) return;
    setConfirm(true);
  }, [props.askRemove]);
  const [descDraft, setDescDraft] = useState(detail?.description ?? '');
  const descRef = useRef(detail?.description ?? '');
  const savedDesc = useRef(detail?.description ?? '');
  const boundId = useRef(detail?.id ?? props.nodeId);
  const hand = useRef(createHandoff()).current;
  descRef.current = descDraft;

  useEffect(() => {
    setTargetCollection('');
    const incoming = detail?.description ?? '';
    const switched = boundId.current !== (detail?.id ?? props.nodeId);
    boundId.current = detail?.id ?? props.nodeId;
    const decision = takeServerText(descRef.current.trim(), savedDesc.current, incoming, switched);
    if (decision === 'keep') {
      noteDraft();
      return;
    }
    if (decision === 'echo') {
      savedDesc.current = incoming;
      noteDraft();
      return;
    }
    savedDesc.current = incoming;
    descRef.current = incoming;
    setDescDraft(incoming);
    noteDraft();
  }, [props.nodeId, detail?.id, detail?.description]);

  function commitDescription() {
    if (!detail) return;
    const next = descRef.current.trim();
    return hand.send(next, savedDesc.current, () => library.describeNode(detail.id, next));
  }

  useSaveDraft(
    () => detail !== null && hand.dirty(descRef.current.trim(), savedDesc.current),
    () => {
      void commitDescription();
    },
  );

  const memberIds = new Set(detail?.collections.map((item) => item.id) ?? []);
  const others = library.collections.filter((item) => !memberIds.has(item.id));
  const face = library.graph.nodes.find((node) => node.id === props.nodeId);

  async function replaceFace(file: File) {
    const body = new FormData();
    body.append('file', file);
    const res = await apiSend(`/api/nodes/${props.nodeId}/image`, {
      method: 'PUT',
      credentials: 'include',
      body,
    });
    if (!res) {
      library.error = '网络没有连上';
      return;
    }
    if (!res.ok) {
      library.error = await errorMessage(res, '图片没有换上');
      return;
    }
    if (props.collectionId) await library.loadGraph(props.collectionId);
    await library.loadNode(props.nodeId);
  }

  async function addCard(type: CardType, doc?: RichDoc) {
    if (!detail) return;
    const ownerId = detail.id;
    const created = await library.createCard(
      doc
        ? { ownerKind: 'node', ownerId, type: 'rich', content: { doc } }
        : emptyCard('node', ownerId, type),
    );
    if (!created) return;
    freshCardId.current = created.id;
    await library.loadNode(ownerId);
    props.onTouched();
  }

  useEffect(() => {
    const id = freshCardId.current;
    if (!id || !detail?.cards.some((card) => card.id === id)) return;
    const node = document.getElementById(`card-${id}`);
    const scroller = node?.closest('.panel-scroll');
    if (!node || !(scroller instanceof HTMLElement)) return;
    // 详情会再载入一次，空代码卡重新挂上时也会把滚动带走。这段时间里反复对齐，载入结束后再放开。
    const align = () => {
      if (!node.isConnected) return;
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const next = Math.min(max, Math.max(0, top));
      if (Math.abs(scroller.scrollTop - next) < 2) return;
      scroller.scrollTop = next;
    };
    align();
    const onScroll = () => align();
    scroller.addEventListener('scroll', onScroll);
    const observer = new ResizeObserver(align);
    observer.observe(node.parentElement ?? scroller);
    const stop = window.setTimeout(() => {
      if (freshCardId.current === id) freshCardId.current = null;
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    }, 800);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [detail]);

  function addTemplate(id: ExplainTemplateId) {
    void addCard('rich', explainTemplateDoc(id));
  }

  // 拖入 / 粘贴图片：先建空富文本卡占位，上传完再把带图的 doc 写回去。
  async function captureImages(files: File[]) {
    if (!detail || files.length === 0) return;
    const ownerId = detail.id;
    const created = await library.createCard(emptyCard('node', ownerId, 'rich'));
    if (!created) return;
    freshCardId.current = created.id;
    const { doc, error } = await docWithImages(created.id, files);
    // plain 由服务端派生，客户端只交 doc（与富文本编辑器同一写法）。
    if (doc) await library.updateCard(created.id, { doc } as Card['content']);
    if (error !== '') library.error = error;
    await library.loadNode(ownerId);
    props.onTouched();
  }

  // 面板级事件挂在 aside 上，detail 会随读取刷新，用 ref 拿到最新一份，避免闭包过期。
  const captureImagesRef = useRef(captureImages);
  captureImagesRef.current = captureImages;
  const addCardRef = useRef(addCard);
  addCardRef.current = addCard;

  useEffect(() => {
    const root = panel.rootRef.current;
    if (!root) return;
    let depth = 0;
    // 输入框与富文本编辑器走各自的粘贴 / 拖拽逻辑，面板不拦截。
    const guarded = (event: Event) =>
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable], .tiptap') !== null;
    const onPaste = (event: ClipboardEvent) => {
      if (guarded(event)) return;
      const data = event.clipboardData;
      if (!data) return;
      const files = filesFromTransfer(data);
      if (files.length > 0) {
        event.preventDefault();
        captureImagesRef.current(files);
        return;
      }
      const doc = docFromClipboardData(data);
      if (!doc) return;
      event.preventDefault();
      void addCardRef.current('rich', doc);
    };
    const onDragEnter = (event: DragEvent) => {
      if (guarded(event) || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      depth += 1;
      setVeil(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (guarded(event) || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setVeil(false);
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      setVeil(false);
      if (guarded(event) || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      const files = filesFromTransfer(event.dataTransfer);
      if (files.length > 0) captureImagesRef.current(files);
    };
    root.addEventListener('paste', onPaste);
    root.addEventListener('dragenter', onDragEnter);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave);
    root.addEventListener('drop', onDrop);
    return () => {
      root.removeEventListener('paste', onPaste);
      root.removeEventListener('dragenter', onDragEnter);
      root.removeEventListener('dragover', onDragOver);
      root.removeEventListener('dragleave', onDragLeave);
      root.removeEventListener('drop', onDrop);
    };
  }, [panel.rootRef]);

  // 模板浮层：点浮层外或 Esc 收起。
  useEffect(() => {
    if (!tplOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (tplPopRef.current?.contains(target) || moreBtnRef.current?.contains(target)) return;
      setTplOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTplOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tplOpen]);

  return (
    <PanelShell
      title={detail?.name ?? '点'}
      onLeave={props.onLeave}
      className="is-node"
      style={{ width: panel.width }}
      rootRef={panel.rootRef}
      onResizePointerDown={panel.onResizePointerDown}
      footer={
        <div className="node-add-dock">
          {tplOpen ? (
            <div className="tpl-pop" ref={tplPopRef}>
              <p className="tpl-pop-sec">
                解释模板 <em>建一张带小节的富文本</em>
              </p>
              <div className="tpl-list">
                {EXPLAIN_TEMPLATES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="tpl-item"
                    title={TEMPLATE_HINTS[item.id]}
                    onClick={() => {
                      setTplOpen(false);
                      addTemplate(item.id);
                    }}
                  >
                    <b>{item.title}</b>
                    <span>{TEMPLATE_HINTS[item.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="dock-tools">
            {MORE_TYPES.map((type) => {
              const meta = cardMeta(type);
              return (
                <button
                  key={type}
                  type="button"
                  className="dock-tool"
                  data-tip={meta.label}
                  aria-label={meta.label}
                  title={meta.label}
                  onClick={() => void addCard(type)}
                >
                  <i style={{ background: meta.hue }}>{meta.glyph}</i>
                </button>
              );
            })}
            <span className="dock-hint">拖图 / ⌘V 直接建卡</span>
          </div>
          <div className="dock-bar">
            <button type="button" className="record-btn" onClick={() => void addCard('rich')}>
              <IconPlus size={15} />
              记录
            </button>
            <button
              ref={moreBtnRef}
              type="button"
              className={tplOpen ? 'more-btn on' : 'more-btn'}
              aria-label="解释模板"
              aria-expanded={tplOpen}
              title="解释模板"
              onClick={() => setTplOpen((open) => !open)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2 3.2C2 2.54 2.54 2 3.2 2h9.6c.66 0 1.2.54 1.2 1.2v9.6c0 .66-.54 1.2-1.2 1.2H3.2A1.2 1.2 0 0 1 2 12.8V3.2Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path d="M4.8 5.4h6.4M4.8 8h6.4M4.8 10.6h3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      }
    >
      {veil ? (
        <div className="drop-veil" aria-hidden="true">
          <div className="drop-veil-frame" />
          <div className="drop-veil-msg">
            <span className="drop-veil-ico">🖼</span>
            松开，建一张带图片的富文本
          </div>
        </div>
      ) : null}
      {!detail ? <p className="muted">正在读取…</p> : null}
      {detail ? (
        <>
          <NameField
            id={detail.id}
            label="名字"
            value={detail.name}
            onSave={(value) => library.renameNode(detail.id, value)}
          />
          <div className="field">
            <label htmlFor={`desc-${detail.id}`}>描述</label>
            <UTextArea
              id={`desc-${detail.id}`}
              className="desc-tf"
              placeholder="一句话，图上会直接显示"
              maxLength={160}
              value={descDraft}
              onChange={(event) => {
                descRef.current = event.target.value;
                setDescDraft(event.target.value);
                hand.edit();
              }}
              onBlur={() => {
                void commitDescription();
              }}
            />
          </div>
          {face?.kind === 'image' ? (
            <div className="panel-block node-face-block">
              {face.assetId ? (
                <img className="node-face" alt={detail.name} draggable={false} src={'/api/assets/' + face.assetId} />
              ) : null}
              <UButton
                onClick={() => {
                  faceFileRef.current?.click();
                }}
              >
                更换图片
              </UButton>
              <input
                ref={faceFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  input.value = '';
                  if (!file) return;
                  const issue = imageFileIssue(file);
                  if (issue) {
                    library.error = issue;
                    return;
                  }
                  void replaceFace(file);
                }}
              />
            </div>
          ) : null}
          <CardStack
            hideAdd
            focusCardId={props.focusCardId}
            types={CARD_TYPES}
            cards={detail.cards}
            onCreate={(type: CardType) => {
              void addCard(type);
            }}
            onUpdate={(cardId, content) => library.updateCard(cardId, content)}
            onDelete={(cardId) => {
              void (async () => {
                const ok = await library.deleteCard(cardId);
                if (ok) props.onTouched();
              })();
            }}
          />
          <div className="panel-block">
            <p className="panel-h">已加入</p>
            {detail.collections.length === 0 ? (
              <p className="muted">还没有放进合集</p>
            ) : (
              <div className="member-list">
                {detail.collections.map((item) =>
                  item.id === props.collectionId ? (
                    <div key={item.id} className="member">
                      {item.title}
                      <span className="here">当前</span>
                    </div>
                  ) : (
                    <Link key={item.id} className="member" to={`/c/${item.id}?node=${detail.id}`}>
                      {item.title}
                      <span className="row-go" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  ),
                )}
              </div>
            )}
          </div>
          <div className="panel-block">
            <p className="panel-h">也放入</p>
            {others.length === 0 ? (
              <p className="muted">已经在所有合集里</p>
            ) : (
              <div className="put-row">
                <USelect
                  ariaLabel="放入哪个合集"
                  placeholder="选择合集"
                  value={targetCollection}
                  options={others.map((item) => ({ value: item.id, label: item.title }))}
                  onChange={setTargetCollection}
                />
                <UButton
                  disabled={targetCollection === ''}
                  onClick={() => {
                    void (async () => {
                      const result = await library.addMember(targetCollection, detail.id);
                      if (!result) return;
                      setTargetCollection('');
                      toast('已放入');
                      await library.loadNode(detail.id);
                    })();
                  }}
                >
                  放入
                </UButton>
              </div>
            )}
          </div>
          <div className="insp-danger">
            {props.collectionId ? (
              <button type="button" onClick={() => setAdding(true)}>
                加入已有点
              </button>
            ) : null}
            {props.collectionId && props.onAskRemove ? (
              <button type="button" onClick={props.onAskRemove}>
                移出当前合集
              </button>
            ) : null}
            <button type="button" className="danger" onClick={() => setConfirm(true)}>
              删除这个点
            </button>
          </div>
        </>
      ) : null}
      {confirm && detail ? (
        <UConfirm
          title="删除这个点"
          body={deleteBody(detail.collections.map((item) => item.title))}
          confirmLabel="删除"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void (async () => {
              const ok = await library.deleteNode(props.nodeId);
              if (ok) props.onLeave();
            })();
          }}
        />
      ) : null}
      {adding && props.collectionId && detail ? (
        <AddMemberDialog
          collectionId={props.collectionId}
          parentId={
            library.graphId === props.collectionId && library.graph.nodes.some((node) => node.id === detail.id)
              ? detail.id
              : null
          }
          onClose={() => setAdding(false)}
          onDone={(_status, nodeId) => {
            props.onLocated?.(nodeId);
          }}
        />
      ) : null}
    </PanelShell>
  );
});

function deleteBody(titles: string[]): string {
  const where = titles.length > 0 ? `它会从这些合集去掉：${titles.join('、')}。` : '它现在不在任何合集里。';
  return `这个点会去掉，连着它的关系也会去掉。${where}`;
}
