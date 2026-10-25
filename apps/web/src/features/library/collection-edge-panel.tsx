import { observer, useService } from '@rabjs/react';
import type { CardType } from '@unfold/dto';
import { useState } from 'react';
import { PanelShell } from '../../shared/panel/panel-shell.js';
import { NameField } from '../../shared/name-field/name-field.js';
import { UButton } from '../../shared/ui/button/button.js';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { CardStack } from '../cards/card-stack.js';
import { emptyCard } from '../cards/empty-card.js';
import { LibraryService } from './library.service.js';

export const CollectionEdgePanel = observer(function CollectionEdgePanel(props: {
  id: string;
  onLeave: () => void;
  onDeleted: () => void;
}) {
  const library = useService(LibraryService);
  const [confirm, setConfirm] = useState(false);
  const detail = library.collectionEdgeDetail?.id === props.id ? library.collectionEdgeDetail : null;

  async function reload() {
    await library.loadCollectionEdge(props.id);
    await library.loadLibrary();
  }

  return (
    <PanelShell title="合集关系" onLeave={props.onLeave}>
      {!detail ? <p className="muted">正在读取…</p> : null}
      {detail ? (
        <>
          <p className="panel-kicker">
            {detail.fromTitle}
            <span className="arrow">→</span>
            {detail.toTitle}
          </p>
          <NameField
            id={detail.id}
            label="关系"
            maxLength={40}
            value={detail.label}
            onSave={(value) => {
              void library.renameCollectionEdge(detail.id, value);
            }}
          />
          <CardStack
            cards={detail.cards}
            onCreate={(type: CardType) => {
              void (async () => {
                const created = await library.createCard(emptyCard('collection_edge', detail.id, type));
                if (created) await reload();
              })();
            }}
            onUpdate={(id, content) => {
              void library.updateCard(id, content);
            }}
            onDelete={(id) => {
              void library.deleteCard(id);
            }}
          />
          <div className="panel-actions">
            <UButton variant="danger" onClick={() => setConfirm(true)}>
              删除关系
            </UButton>
          </div>
        </>
      ) : null}
      {confirm ? (
        <UConfirm
          title="删除关系"
          body="这条合集之间的关系会去掉，挂在上面的卡片也一起去掉。"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void (async () => {
              const ok = await library.deleteCollectionEdge(props.id);
              if (ok) props.onDeleted();
            })();
          }}
        />
      ) : null}
    </PanelShell>
  );
});
