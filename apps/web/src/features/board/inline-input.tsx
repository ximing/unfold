import { useEffect, useRef } from 'react';
import { noteDraft } from '../../shared/save/save-bus.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';

/** 图上的内联输入：创建、改名、写关系共用 */
export function InlineInput(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  initial?: string;
  placeholder: string;
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

  return (
    <foreignObject x={props.x} y={props.y} width={props.w} height={props.h} className="binput">
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
    </foreignObject>
  );
}
