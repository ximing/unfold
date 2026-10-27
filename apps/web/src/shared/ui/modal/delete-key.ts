import { useEffect } from 'react';

type DeleteKey = {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export function isPlainDelete(event: DeleteKey): boolean {
  if (event.repeat || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.key === 'Backspace' || event.key === 'Delete';
}

export function isTextEditing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return true;
  }
  return target.closest('.tiptap, input, textarea, [contenteditable="true"], .usel') !== null;
}

/** 检查器打开时，Delete / Backspace 只请求确认，不直接删除。 */
export function useAskDelete(onAsk: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPlainDelete(event)) return;
      if (isTextEditing(event.target)) return;
      if (document.querySelector('.modal-wrap, .overlay, .ctx-menu')) return;
      event.preventDefault();
      onAsk();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onAsk]);
}
