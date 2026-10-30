import { useEffect, useRef } from 'react';
import { noteDraft } from '../../shared/save/save-bus.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';

/** 图上的内联输入：创建、改名、写关系共用。node 变体融进节点框，pill 变体自带浮层描边。 */
export function InlineInput(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  /** node：描边由节点框负责，输入框透明无边；pill（默认）：输入框自带圆角浮层，用于边标签。 */
  variant?: 'node' | 'pill';
  initial?: string;
  placeholder: string;
  /** 点一下只填进输入框，不提交。 */
  suggestions?: readonly string[];
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const valueRef = useRef(props.initial ?? '');
  const committed = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function finish(text: string) {
    if (committed.current) return;
    committed.current = true;
    const next = text.trim();
    if (next === '') props.onCancel();
    else props.onCommit(next);
    noteDraft();
  }

  useSaveDraft(
    () => !committed.current && valueRef.current.trim() !== (props.initial ?? '').trim(),
    () => finish(valueRef.current),
    false,
  );

  const picks = props.suggestions ?? [];
  const extra = picks.length > 0 ? 44 : 0;
  return (
    <foreignObject
      x={props.x}
      y={props.y}
      width={Math.max(props.w, picks.length > 0 ? 220 : props.w)}
      height={props.h + extra}
      className={props.variant === 'node' ? 'binput binput-node' : 'binput'}
    >
      <div className="binput-stack">
        <input
          ref={ref}
          defaultValue={props.initial ?? ''}
          placeholder={props.placeholder}
          maxLength={80}
          onChange={(event) => {
            valueRef.current = event.target.value;
            noteDraft();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              finish(event.currentTarget.value);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              if (committed.current) return;
              committed.current = true;
              props.onCancel();
              noteDraft();
            }
          }}
          onBlur={(event) => finish(event.currentTarget.value)}
        />
        {picks.length > 0 ? (
          <div className="blink-picks" role="group" aria-label="最近的标签">
            {picks.map((label) => (
              <button
                key={label}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const input = ref.current;
                  if (!input) return;
                  input.value = label;
                  valueRef.current = label;
                  noteDraft();
                  input.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </foreignObject>
  );
}
