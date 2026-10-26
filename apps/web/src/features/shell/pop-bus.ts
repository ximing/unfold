const EVENT = 'unfold:dock-pop';

/** 打开一个操作区弹层时调用，关掉其他弹层。 */
export function closeOtherPops(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onPopClose(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
