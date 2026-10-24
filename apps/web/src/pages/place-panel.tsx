import { observer, useService } from '@rabjs/react';
import { useEffect, useState } from 'react';
import { LibraryService } from '../services/library.service.js';

function editingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  return target.closest('[contenteditable="true"]') !== null;
}

export const PlacePanel = observer(function PlacePanel({
  objectId,
  domainId,
}: {
  objectId: string;
  domainId: string;
}) {
  const library = useService(LibraryService);
  const [name, setName] = useState('');
  const [intent, setIntent] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    setMessage('');
    void library.loadFiledCollections(objectId, domainId);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') || event.shiftKey) {
        return;
      }
      if (editingTarget(event.target)) return;
      event.preventDefault();
      void (async () => {
        const ok = await library.undoStructure();
        if (!alive) return;
        if (!ok) {
          setMessage(library.error);
          return;
        }
        setMessage('');
        await library.loadFiledCollections(objectId, domainId);
      })();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      alive = false;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [domainId, library, objectId]);

  const filedIds = library.filedCollectionIds;
  const collections = library.collections;
  const filed: { id: string; title: string }[] = [];
  for (const id of filedIds) {
    const found = collections.find((item) => item.id === id);
    if (!found) continue;
    filed.push({ id, title: found.title });
  }
  const openCollections = collections.filter(
    (item) =>
      item.domainId === domainId && item.parentCollectionId === null && !filedIds.includes(item.id),
  );

  async function settle(done: Promise<boolean>) {
    const ok = await done;
    setMessage(ok ? '' : library.error);
  }

  return (
    <section className="place">
      <h2>归位</h2>
      {filedIds.length === 0 ? (
        <p className="muted">这个点现在是游离的。归位不改变 ID、关系和证据。</p>
      ) : (
        <p className="muted">已编入：{filed.map((item) => item.title).join('、')}</p>
      )}
      {openCollections.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            void settle(library.fileObject(item.id, objectId));
          }}
        >
          {`编入「${item.title}」`}
        </button>
      ))}
      {filed.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            void settle(library.unfileObject(item.id, objectId));
          }}
        >
          {`移出「${item.title}」`}
        </button>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const title = name.trim();
          if (title === '') return;
          const nextIntent = intent.trim();
          void (async () => {
            const ok = await library.createCollectionAndFile(domainId, title, nextIntent, objectId);
            if (!ok) {
              setMessage(library.error);
              return;
            }
            setName('');
            setIntent('');
            setMessage('');
          })();
        }}
      >
        <input
          value={name}
          placeholder="合集名称"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          value={intent}
          placeholder="编排意图"
          onChange={(event) => setIntent(event.target.value)}
        />
        <button type="submit">新建合集并编入</button>
      </form>
      <button
        type="button"
        onClick={() => {
          void (async () => {
            const ok = await library.undoStructure();
            if (!ok) {
              setMessage(library.error);
              return;
            }
            setMessage('');
            await library.loadFiledCollections(objectId, domainId);
            await library.loadDomains();
          })();
        }}
      >
        撤销上一条结构命令（⌘Z）
      </button>
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
});
