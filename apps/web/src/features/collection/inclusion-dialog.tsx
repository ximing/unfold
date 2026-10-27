import { observer, useService } from '@rabjs/react';
import type { InclusionCandidate } from '@unfold/dto';
import { useEffect, useState, type FormEvent } from 'react';
import { LibraryService } from '../library/library.service.js';
import { UButton } from '../../shared/ui/button/button.js';
import { UField, UTextInput } from '../../shared/ui/field/field.js';
import { UModal } from '../../shared/ui/modal/modal.js';
import './inclusion-dialog.css';

export const InclusionDialog = observer(function InclusionDialog(props: {
  collectionId: string;
  origin: { x: number; y: number };
  onClose: () => void;
  onInserted: () => void;
}) {
  const library = useService(LibraryService);
  const [rows, setRows] = useState<InclusionCandidate[] | null>(null);
  const [selected, setSelected] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void library.loadInclusionCandidates(props.collectionId).then((body) => {
      if (!alive) return;
      setRows(body?.collections ?? []);
    });
    return () => {
      alive = false;
    };
  }, [library, props.collectionId]);

  const current = rows?.find((row) => row.id === selected) ?? null;
  const linked = current?.linked === true;
  const canSubmit = current !== null && !busy && (linked || label.trim() !== '');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || busy) return;
    if (!linked && label.trim() === '') return;
    setBusy(true);
    const ok = await library.createInclusion(props.collectionId, {
      childId: current.id,
      originX: props.origin.x,
      originY: props.origin.y,
      ...(linked ? {} : { label: label.trim() }),
    });
    setBusy(false);
    if (!ok) return;
    props.onInserted();
    props.onClose();
  }

  return (
    <UModal title="插入子集合" onClose={props.onClose}>
      <form onSubmit={(event) => void onSubmit(event)}>
        <p className="inclusion-note">选择要放进来的合集</p>
        {rows === null ? <p className="inclusion-note">正在读取</p> : null}
        {rows !== null && rows.length === 0 ? <p className="inclusion-note">没有可以放入的合集</p> : null}
        {rows !== null && rows.length > 0 ? (
          <ul className="inclusion-picks">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === selected ? 'on' : undefined}
                  aria-pressed={row.id === selected}
                  onClick={() => {
                    setSelected(row.id);
                    setLabel('');
                  }}
                >
                  <span>{row.title}</span>
                  <span className="count">{row.nodeCount} 个点</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {current && linked ? (
          <p className="inclusion-note">
            {current.labels.length > 0 ? `已有关系：${current.labels.join('、')}` : '已经有连线，可以直接引入'}
          </p>
        ) : null}
        {current && !linked ? (
          <UField label="关系" htmlFor="inclusion-label" hint="从当前合集指向这个合集">
            <UTextInput
              id="inclusion-label"
              value={label}
              maxLength={40}
              placeholder="例如：包含"
              autoFocus
              onChange={(event) => setLabel(event.target.value)}
            />
          </UField>
        ) : null}
        {library.error !== '' ? <p role="alert">{library.error}</p> : null}
        <div className="ft">
          <UButton onClick={props.onClose}>取消</UButton>
          <UButton variant="primary" type="submit" disabled={!canSubmit}>
            引入
          </UButton>
        </div>
      </form>
    </UModal>
  );
});
