import { observer, useService } from '@rabjs/react';
import type { CardType } from '@unfold/dto';
import { useState } from 'react';
import { PanelShell } from '../../shared/panel/panel-shell.js';
import { NameField } from '../../shared/name-field/name-field.js';
import { UButton } from '../../shared/ui/button/button.js';
import { UConfirm } from '../../shared/ui/modal/modal.js';
import { CARD_TYPES } from '../cards/card-meta.js';
import { CardStack } from '../cards/card-stack.js';
import { emptyCard } from '../cards/empty-card.js';
import { LibraryService } from '../library/library.service.js';

const EDGE_CARD_TYPES = CARD_TYPES.filter((type) => type !== 'rich');

export const EdgePanel = observer(function EdgePanel(props: { edgeId: string; onLeave: () => void; onTouched: () => void }) {
  const library = useService(LibraryService);
  const [confirm, setConfirm] = useState(false);
  const detail = library.edgeDetail?.id === props.edgeId ? library.edgeDetail : null;

  return (
    <PanelShell title="关系" onLeave={props.onLeave}>
      {!detail ? <p className="muted">正在读取…</p> : null}
      {detail ? (
        <>
          <p className="panel-kicker">
            {detail.fromName}
            <span className="arrow">→</span>
            {detail.toName}
          </p>
          <NameField
            id={detail.id}
            label="关系"
            maxLength={40}
            value={detail.label}
            onSave={(value) => {
              void library.renameEdge(detail.id, value);
            }}
          />
          <CardStack
            types={EDGE_CARD_TYPES}
            cards={detail.cards}
            onCreate={(type: CardType) => {
              void (async () => {
                const created = await library.createCard(emptyCard('edge', detail.id, type));
                if (!created) return;
                await library.loadEdge(detail.id);
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
          body="这条关系会去掉，挂在上面的卡片也一起去掉。"
          confirmLabel="删除"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void (async () => {
              const ok = await library.deleteEdge(props.edgeId);
              if (ok) props.onLeave();
            })();
          }}
        />
      ) : null}
    </PanelShell>
  );
});
