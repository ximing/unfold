import type { ReactNode } from 'react';
import { IconClose } from '../ui/icons/icons.js';
import './panel.css';

export function PanelShell(props: { title: string; onLeave: () => void; children: ReactNode }) {
  return (
    <aside className="board-panel">
      <div className="panel-head">
        <span className="panel-title">{props.title}</span>
        <button type="button" className="ibtn" aria-label="关闭" onClick={props.onLeave}>
          <IconClose />
        </button>
      </div>
      <div className="panel-scroll">{props.children}</div>
    </aside>
  );
}
