import { Image, MousePointer2, Spline, Type } from 'lucide-react';
import './board-toolbar.css';

export type BoardTool = 'select' | 'text' | 'connect';

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
        <MousePointer2 size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className={props.tool === 'text' ? 'on' : undefined}
        aria-label="文字"
        aria-pressed={props.tool === 'text'}
        title="文字 T"
        onClick={() => props.onTool('text')}
      >
        <Type size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button type="button" aria-label="图片" title="图片 I" onClick={props.onImage}>
        <Image size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className={props.tool === 'connect' ? 'on' : undefined}
        aria-label="连线"
        aria-pressed={props.tool === 'connect'}
        title="连线 L"
        onClick={() => props.onTool('connect')}
      >
        <Spline size={18} strokeWidth={1.75} aria-hidden />
      </button>
    </nav>
  );
}
