import { observer, useService } from '@rabjs/react';
import type { CardType } from '@unfold/dto';
import { useEffect, useState } from 'react';
import { PanelShell } from '../../shared/panel/panel-shell.js';
import { NameField } from '../../shared/name-field/name-field.js';
import { UButton } from '../../shared/ui/button/button.js';
import { UTextArea } from '../../shared/ui/field/field.js';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { USelect } from '../../shared/ui/select/select.js';
import { toast } from '../../shared/ui/toast/toast.js';
import { CardStack } from '../cards/card-stack.js';
import { emptyCard } from '../cards/empty-card.js';
import { LibraryService } from '../library/library.service.js';

export const NodePanel = observer(function NodePanel(props: {
  collectionId: string;
  nodeId: string;
  onLeave: () => void;
  onTouched: () => void;
}) {
  const library = useService(LibraryService);
  const [targetCollection, setTargetCollection] = useState('');
  const [confirm, setConfirm] = useState(false);
  const detail = library.nodeDetail?.id === props.nodeId ? library.nodeDetail : null;
  const [descDraft, setDescDraft] = useState('');

  useEffect(() => {
    setTargetCollection('');
    setDescDraft(detail?.description ?? '');
     
  }, [props.nodeId, detail?.id, detail?.description]);

  const memberIds = new Set(detail?.collections.map((item) => item.id) ?? []);
  const others = library.collections.filter((item) => !memberIds.has(item.id));

  return (
    <PanelShell title={detail?.name ?? '点'} onLeave={props.onLeave}>
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
          <CardStack
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
