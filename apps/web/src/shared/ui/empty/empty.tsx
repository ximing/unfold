import type { ReactNode } from 'react';
import './empty.css';

export function UEmptyState(props: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{props.text}</p>
      {props.action}
    </div>
  );
}
