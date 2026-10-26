import { observer, useService } from '@rabjs/react';
import type { CardType } from '@unfold/dto';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PanelShell } from '../../shared/panel/panel-shell.js';
import { NameField } from '../../shared/name-field/name-field.js';
import { UButton } from '../../shared/ui/button/button.js';
import { UTextArea } from '../../shared/ui/field/field.js';
import { useAskDelete } from '../../shared/ui/modal/delete-key.js';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { USelect } from '../../shared/ui/select/select.js';
import { toast } from '../../shared/ui/toast/toast.js';
import { CARD_TYPES } from '../cards/card-meta.js';
import { CardStack } from '../cards/card-stack.js';
import { emptyCard } from '../cards/empty-card.js';
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

export const NodePanel = observer(function NodePanel(props: {
  collectionId: string;
  nodeId: string;
  onLeave: () => void;
  onTouched: () => void;
}) {
  const library = useService(LibraryService);
  const panel = useNodePanelWidth();
  const faceFileRef = useRef<HTMLInputElement>(null);
  const [targetCollection, setTargetCollection] = useState('');
  const [confirm, setConfirm] = useState(false);
  const detail = library.nodeDetail?.id === props.nodeId ? library.nodeDetail : null;
  useAskDelete(() => setConfirm(true));
  const [descDraft, setDescDraft] = useState('');

  useEffect(() => {
    setTargetCollection('');
    setDescDraft(detail?.description ?? '');
     
  }, [props.nodeId, detail?.id, detail?.description]);

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
    await library.loadGraph(props.collectionId);
    await library.loadNode(props.nodeId);
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
            onSave={(value) => {
              void library.renameNode(detail.id, value);
            }}
          />
          <div className="field">
            <label htmlFor={`desc-${detail.id}`}>描述</label>
            <UTextArea
              id={`desc-${detail.id}`}
              className="desc-tf"
              placeholder="一句话，图上会直接显示"
              maxLength={160}
              value={descDraft}
              onChange={(event) => setDescDraft(event.target.value)}
              onBlur={() => {
                const next = descDraft.trim();
                if (next !== detail.description) void library.describeNode(detail.id, next);
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
            types={CARD_TYPES}
            cards={detail.cards}
            onCreate={(type: CardType) => {
              void (async () => {
                const created = await library.createCard(emptyCard('node', detail.id, type));
                if (!created) return;
                await library.loadNode(detail.id);
                props.onTouched();
              })();
            }}
            onUpdate={(cardId, content) => {
              void library.updateCard(cardId, content);
            }}
            onDelete={(cardId) => {
              void (async () => {
                const ok = await library.deleteCard(cardId);
                if (ok) props.onTouched();
              })();
            }}
          />
          <div className="panel-block">
            <p className="panel-h">也放入</p>
            {others.length === 0 ? (
              <p className="muted">已经在所有合集里</p>
            ) : (
              <div className="connect-row">
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
                      const ok = await library.addMember(targetCollection, detail.id);
                      if (!ok) return;
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
          <div className="panel-actions">
            <UButton
              onClick={() => {
                void (async () => {
                  const ok = await library.removeMember(props.collectionId, detail.id);
                  if (ok) props.onLeave();
                })();
              }}
            >
              移出这个合集
            </UButton>
            <UButton variant="danger" onClick={() => setConfirm(true)}>
              删除这个点
            </UButton>
          </div>
        </>
      ) : null}
      {confirm ? (
        <UConfirm
          title="删除这个点"
          body="这个点会去掉，连着它的关系也会去掉。"
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
    </PanelShell>
  );
});
