import { useSyncExternalStore } from 'react';
import './toast.css';

type ToastItem = { id: number; text: string; tone: 'ok' | 'warn' };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function toast(text: string, tone: 'ok' | 'warn' = 'ok') {
  const id = nextId++;
  items = [...items, { id, text, tone }];
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 3000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ToastHost() {
  const current = useSyncExternalStore(subscribe, () => items);
  if (current.length === 0) return null;
  return (
    <div className="toast-stack" role="status">
      {current.map((item) => (
        <div key={item.id} className={item.tone === 'warn' ? 'toast warn-t' : 'toast'}>
          <span className="dot" />
          {item.text}
        </div>
      ))}
    </div>
  );
}
