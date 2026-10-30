import { observer, useService } from '@rabjs/react';
import type { CardType, RichDoc } from '@unfold/dto';
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
  const [moreOpen, setMoreOpen] = useState(false);
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
    const created = await library.createCard(
      doc
        ? { ownerKind: 'node', ownerId: detail.id, type: 'rich', content: { doc } }
        : emptyCard('node', detail.id, type),
    );
    if (!created) return;
    await library.loadNode(detail.id);
    props.onTouched();
  }

  function addTemplate(id: ExplainTemplateId) {
    void addCard('rich', explainTemplateDoc(id));
  }

  return (
    <PanelShell
      title={detail?.name ?? '点'}
      onLeave={props.onLeave}
      className="is-node"
      style={{ width: panel.width }}
      rootRef={panel.rootRef}
      onResizePointerDown={panel.onResizePointerDown}
    >
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
          <div className="panel-block">
            <button type="button" className="record-btn" onClick={() => void addCard('rich')}>
              <IconPlus size={15} />
              记录
            </button>
            <button
              type="button"
              className={moreOpen ? 'more-toggle open' : 'more-toggle'}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span className="tri" aria-hidden="true">
                ▶
              </span>
              更多类型
            </button>
            {moreOpen ? (
              <div className="type-grid">
                {MORE_TYPES.map((type) => {
                  const meta = cardMeta(type);
                  return (
                    <button key={type} type="button" className="type-cell" onClick={() => void addCard(type)}>
                      <i style={{ background: meta.hue }}>{meta.glyph}</i>
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="panel-block">
            <p className="panel-h">解释模板</p>
            <div className="tpl-grid tpl-inset">
              {EXPLAIN_TEMPLATES.map((item) => (
                <button key={item.id} type="button" className="tpl" onClick={() => addTemplate(item.id)}>
                  <b>{item.title}</b>
                  <span>{TEMPLATE_HINTS[item.id]}</span>
                </button>
              ))}
            </div>
          </div>
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
