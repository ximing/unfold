import { useEffect, useRef, useState } from 'react';
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
  const stackRef = useRef<HTMLDivElement>(null);
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

  const picks = (props.suggestions ?? []).slice(0, 8);
  const pop = props.variant !== 'node' && picks.length > 0;
  /* foreignObject 高度固定，建议标签行数不定：实测卡片高度回填，避免标签被截断。
     ResizeObserver 的 contentRect 是布局尺寸，不受画布缩放影响。 */
  const [popHeight, setPopHeight] = useState(0);
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || !pop) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setPopHeight(Math.ceil(entry.contentRect.height));
    });
    observer.observe(stack);
    return () => observer.disconnect();
  }, [pop]);
  return (
    <foreignObject
      x={props.x}
      y={props.y}
      width={Math.max(props.w, pop ? 240 : props.w)}
      height={pop ? Math.max(popHeight, props.h + 66) : props.h}
      className={props.variant === 'node' ? 'binput binput-node' : 'binput'}
    >
      <div ref={stackRef} className={pop ? 'binput-stack binput-pop' : 'binput-stack'}>
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
        {pop ? (
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
