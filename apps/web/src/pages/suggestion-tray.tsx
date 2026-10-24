import { observer, useService } from '@rabjs/react';
import { useEffect } from 'react';
import { LibraryService } from '../services/library.service.js';

function editingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  return target.closest('[contenteditable="true"]') !== null;
}

export const SuggestionTray = observer(function SuggestionTray({ objectId }: { objectId: string }) {
  const library = useService(LibraryService);

  useEffect(() => {
    library.suggestionError = '';
    void library.loadSuggestions(objectId);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'a' && event.key !== 's') return;
      if (editingTarget(event.target)) return;
      const pending = library.suggestions.find((item) => item.status === 'pending');
      if (!pending) return;
      event.preventDefault();
      const status = event.key === 'a' ? 'accepted' : 'deferred';
      void (async () => {
        const ok = await library.resolveSuggestion(pending.id, status);
        if (!ok) return;
        await library.loadSuggestions(objectId);
        if (status === 'accepted') await library.loadRelations(objectId);
      })();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [library, objectId]);

  async function apply(suggestionId: string, status: 'accepted' | 'deferred' | 'rejected') {
    const ok = await library.resolveSuggestion(suggestionId, status);
    if (!ok) return;
    await library.loadSuggestions(objectId);
    if (status === 'accepted') await library.loadRelations(objectId);
  }

  if (library.suggestions.length === 0 && library.suggestionNotice === '') return null;

  return (
    <section className="tray">
      <h2>连接建议</h2>
      {library.suggestionNotice === '模型建议这次没有生成' ? (
        <p className="muted">{library.suggestionNotice}</p>
      ) : null}
      {library.suggestions.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            void library.deferSuggestions(objectId);
          }}
        >
          整层稍后
        </button>
      ) : null}
      {library.suggestions.map((item) => (
        <div key={item.id}>
          <p>{item.summary}</p>
          <p className="muted">
            {item.origin === 'model' ? '来源：模型' : '来源：规则'}
            {item.status === 'deferred' ? ' · 先放着' : ''}
          </p>
          <button
            type="button"
            onClick={() => {
              void apply(item.id, 'accepted');
            }}
          >
            {item.acceptLabel}
          </button>
          {item.status !== 'deferred' ? (
            <button
              type="button"
              onClick={() => {
                void apply(item.id, 'deferred');
              }}
            >
              先不
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void apply(item.id, 'rejected');
            }}
          >
            忽略
          </button>
        </div>
      ))}
      {library.suggestionError ? <p role="alert">{library.suggestionError}</p> : null}
    </section>
  );
});
