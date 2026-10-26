import { observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { PanelShell } from '../../shared/panel/panel-shell.js';
import { NameField } from '../../shared/name-field/name-field.js';
import { UButton } from '../../shared/ui/button/button.js';
import { USelect } from '../../shared/ui/select/select.js';
import { LibraryService } from './library.service.js';

export const CollectionPanel = observer(function CollectionPanel(props: {
  id: string;
  title: string;
  onOpen: () => void;
  onAskDelete: () => void;
  onSelectEdge: (id: string) => void;
  onLeave: () => void;
}) {
  const library = useService(LibraryService);
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const others = library.collections.filter((item) => item.id !== props.id);
  const touching = (library.libraryGraph?.edges ?? []).filter(
    (edge) => edge.fromId === props.id || edge.toId === props.id,
  );

  useEffect(() => {
    setTarget('');
    setLabel('');
  }, [props.id]);

  return (
    <PanelShell title={props.title} onLeave={props.onLeave}>
      <NameField
        id={props.id}
        label="标题"
        value={props.title}
        onSave={(value) => library.renameCollection(props.id, value)}
      />
      <div className="panel-actions" style={{ marginTop: 0 }}>
        <UButton variant="primary" onClick={props.onOpen}>
          打开
        </UButton>
        <UButton variant="danger" onClick={props.onAskDelete}>
          删除合集
        </UButton>
      </div>
      <div className="panel-block">
        <p className="panel-h">连接到</p>
        {others.length === 0 ? (
          <p className="muted">还没有其他合集</p>
        ) : (
          <div className="connect-row">
            <USelect
              ariaLabel="连到哪个合集"
              placeholder="另一个合集"
              value={target}
              options={others.map((item) => ({ value: item.id, label: item.title }))}
              onChange={setTarget}
            />
            <input
              className="tf"
              aria-label="关系"
              placeholder="例如：相关"
              maxLength={40}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <UButton
              variant="primary"
              disabled={target === '' || label.trim() === ''}
              onClick={() => {
                void (async () => {
                  const created = await library.createCollectionEdge(props.id, target, label);
                  if (!created) return;
                  setLabel('');
                  await library.loadLibrary();
                  props.onSelectEdge(created.id);
                })();
              }}
            >
              连上
            </UButton>
          </div>
        )}
        {touching.length > 0 ? (
          <ul className="edge-list">
            {touching.map((edge) => {
              const otherId = edge.fromId === props.id ? edge.toId : edge.fromId;
              const other = library.collections.find((item) => item.id === otherId);
              return (
                <li key={edge.id}>
                  <button type="button" onClick={() => props.onSelectEdge(edge.id)}>
                    {other?.title ?? '合集'} · {edge.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </PanelShell>
  );
});
