import type { ReactNode } from 'react';
import './board-toolbar.css';

export type BoardTool = 'select' | 'text' | 'connect';

function Glyph(props: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

export function BoardToolbar(props: {
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  onImage: () => void;
}) {
  return (
    <nav className="board-toolbar" aria-label="画布工具">
      <button
        type="button"
        className={props.tool === 'select' ? 'on' : undefined}
        aria-label="选择"
        aria-pressed={props.tool === 'select'}
        title="选择 V"
        onClick={() => props.onTool('select')}
      >
        <Glyph>
          <path d="M5 4l6.2 15 1.6-5.6L18.5 12z" />
        </Glyph>
      </button>
      <button
        type="button"
        className={props.tool === 'text' ? 'on' : undefined}
        aria-label="文字"
        aria-pressed={props.tool === 'text'}
        title="文字 T"
        onClick={() => props.onTool('text')}
      >
        <Glyph>
          <path d="M7 6h10M12 6v12" />
        </Glyph>
      </button>
      <button type="button" aria-label="图片" title="图片 I" onClick={props.onImage}>
        <Glyph>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.3" fill="currentColor" stroke="none" />
          <path d="m4 16 4.2-3.2 2.8 2.2 2.4-1.8L20 17" />
        </Glyph>
      </button>
      <button
        type="button"
        className={props.tool === 'connect' ? 'on' : undefined}
        aria-label="连线"
        aria-pressed={props.tool === 'connect'}
        title="连线 L"
        onClick={() => props.onTool('connect')}
      >
        <Glyph>
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M8 12h7" />
          <path d="m12.5 9.2 3.5 2.8-3.5 2.8" />
        </Glyph>
      </button>
    </nav>
  );
}
