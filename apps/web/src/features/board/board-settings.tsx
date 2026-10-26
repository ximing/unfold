import type { CanvasPrefs, EdgeAppearance, EdgeColor } from '@unfold/dto';
import { EDGE_STROKE } from './edge-style.js';
import './board-settings.css';

const DASHES = [
  { id: 'solid', label: '实线' },
  { id: 'dashed', label: '虚线' },
  { id: 'dotted', label: '点线' },
] as const;

const WIDTHS = [
  { id: 'thin', label: '细' },
  { id: 'medium', label: '中' },
  { id: 'thick', label: '粗' },
] as const;

const COLORS: { id: EdgeColor; label: string }[] = [
  { id: 'gray', label: '灰' },
  { id: 'blue', label: '蓝' },
  { id: 'green', label: '绿' },
  { id: 'red', label: '红' },
];

const ROUTES = [
  { id: 'straight', label: '直线' },
  { id: 'curve', label: '曲线' },
  { id: 'orthogonal', label: '折线' },
] as const;

const LABEL_MODES = [
  { id: 'always', label: '始终' },
  { id: 'focus', label: '悬停或选中' },
] as const;

export function BoardSettings(props: {
  appearance: EdgeAppearance;
  canvas: CanvasPrefs;
  onAppearance: (next: EdgeAppearance) => void;
  onCanvas: (patch: Partial<CanvasPrefs>) => void;
}) {
  return (
    <div className="board-settings" role="dialog" aria-label="属性">
      <section>
        <h2>这个合集</h2>
        <Choice
          label="线型"
          value={props.appearance.dash}
          options={DASHES}
          onChange={(dash) => props.onAppearance({ ...props.appearance, dash })}
        />
        <Choice
          label="粗细"
          value={props.appearance.width}
          options={WIDTHS}
          onChange={(width) => props.onAppearance({ ...props.appearance, width })}
        />
        <div className="board-set-row">
          <span>颜色</span>
          <div className="board-set-colors" role="group" aria-label="颜色">
            {COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                aria-label={color.label}
                aria-pressed={props.appearance.color === color.id}
                title={color.label}
                onClick={() => props.onAppearance({ ...props.appearance, color: color.id })}
              >
                <i style={{ background: EDGE_STROKE[color.id].line }} />
              </button>
            ))}
          </div>
        </div>
        <Choice
          label="箭头"
          value={props.appearance.arrow}
          options={[
            { id: 'end', label: '有' },
            { id: 'none', label: '无' },
          ]}
          onChange={(arrow) => props.onAppearance({ ...props.appearance, arrow })}
        />
      </section>
      <section>
        <h2>所有合集</h2>
        <Choice
          label="走线"
          value={props.canvas.route}
          options={ROUTES}
          onChange={(route) => props.onCanvas({ route })}
        />
        <Toggle label="点阵" on={props.canvas.grid} onChange={(grid) => props.onCanvas({ grid })} />
        <Toggle label="吸附" on={props.canvas.snap} onChange={(snap) => props.onCanvas({ snap })} />
        <Choice
          label="标签"
          value={props.canvas.labels}
          options={LABEL_MODES}
          onChange={(labels) => props.onCanvas({ labels })}
        />
        <Toggle label="卡片标记" on={props.canvas.markers} onChange={(markers) => props.onCanvas({ markers })} />
        <Toggle label="小地图" on={props.canvas.minimap} onChange={(minimap) => props.onCanvas({ minimap })} />
      </section>
    </div>
  );
}

function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="board-set-row">
      <span>{props.label}</span>
      <div className="board-set-seg" role="group" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={props.value === option.id}
            onClick={() => props.onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Choice
      label={props.label}
      value={props.on ? 'on' : 'off'}
      options={[
        { id: 'on', label: '开' },
        { id: 'off', label: '关' },
      ]}
      onChange={(id) => props.onChange(id === 'on')}
    />
  );
}
