import { useService } from '@rabjs/react';
import { useState, type FormEvent } from 'react';
import { LibraryService } from '../services/library.service.js';
import { UButton } from './ui/button.js';
import { UField, UTextInput } from './ui/field.js';
import { UModal } from './ui/modal.js';

export function CreateCollectionDialog(props: { onClose: () => void; onCreated: (id: string) => void }) {
  const library = useService(LibraryService);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const created = await library.createCollection(title);
    setBusy(false);
    if (!created) return;
    props.onCreated(created.id);
    props.onClose();
  }

  return (
    <UModal title="新建合集" onClose={props.onClose}>
      <form onSubmit={(event) => void onSubmit(event)}>
        <UField label="标题" htmlFor="new-collection-title">
          <UTextInput
            id="new-collection-title"
            value={title}
            maxLength={80}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </UField>
        {library.error !== '' ? <p role="alert">{library.error}</p> : null}
        <div className="ft">
          <UButton onClick={props.onClose}>取消</UButton>
          <UButton variant="primary" type="submit" disabled={busy || title.trim() === ''}>
            创建
          </UButton>
        </div>
      </form>
    </UModal>
  );
}
