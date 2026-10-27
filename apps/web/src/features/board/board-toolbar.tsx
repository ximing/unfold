import type { CanvasPrefs, EdgeAppearance } from '@unfold/dto';
import { Group, Image, MousePointer2, SlidersHorizontal, Spline, Type } from 'lucide-react';
import { BoardSettings } from './board-settings.js';
import './board-toolbar.css';

export type BoardTool = 'select' | 'text' | 'connect';

export function BoardToolbar(props: {
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  onImage: () => void;
  onInsertInclusion?: () => void;
  settingsOpen: boolean;
  appearance: EdgeAppearance;
  canvas: CanvasPrefs;
  onToggleSettings: () => void;
  onAppearance: (next: EdgeAppearance) => void;
  onCanvas: (patch: Partial<CanvasPrefs>) => void;
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
      {props.onInsertInclusion ? (
        <button type="button" aria-label="子集合" title="子集合" onClick={props.onInsertInclusion}>
          <Group size={18} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
      <span className="board-toolbar-sep" />
      <button
        type="button"
        className={`board-settings-btn${props.settingsOpen ? ' on' : ''}`}
        aria-label="属性"
        aria-expanded={props.settingsOpen}
        title="属性"
        onClick={props.onToggleSettings}
      >
        <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden />
      </button>
      {props.settingsOpen ? (
        <BoardSettings
          appearance={props.appearance}
          canvas={props.canvas}
          onAppearance={props.onAppearance}
          onCanvas={props.onCanvas}
        />
      ) : null}
    </nav>
  );
}
