import { useEffect, useRef } from 'react';
import { registerDraft } from './save-bus.js';

export function useSaveDraft(dirty: () => boolean, flush: () => void, live = true): void {
  const dirtyRef = useRef(dirty);
  const flushRef = useRef(flush);
  dirtyRef.current = dirty;
  flushRef.current = flush;
  useEffect(() => {
    return registerDraft({
      dirty: () => dirtyRef.current(),
      flush: () => flushRef.current(),
      live,
    });
  }, [live]);
}
