import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react';
import { IconClose } from '../ui/icons/icons.js';
import './panel.css';

export function PanelShell(props: {
  title: string;
  onLeave: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  rootRef?: Ref<HTMLElement>;
  onResizePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** 不随面板内容滚动，贴在检查器底部。 */
  footer?: ReactNode;
}) {
  const className = props.className ? `board-panel ${props.className}` : 'board-panel';
  return (
    <aside ref={props.rootRef} className={className} style={props.style}>
      {props.onResizePointerDown ? (
        <div
          className="panel-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整检查器宽度"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            props.onResizePointerDown?.(event);
          }}
        />
      ) : null}
      <div className="panel-head">
        <span className="panel-title">{props.title}</span>
        <button type="button" className="ibtn" aria-label="关闭" onClick={props.onLeave}>
          <IconClose />
        </button>
      </div>
      <div className="panel-scroll">{props.children}</div>
      {props.footer ? <div className="panel-foot">{props.footer}</div> : null}
    </aside>
  );
}
