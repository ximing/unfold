import type { ReactNode } from 'react';

export function UEmptyState(props: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{props.text}</p>
      {props.action}
    </div>
  );
}
