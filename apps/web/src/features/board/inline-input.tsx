import { useEffect, useRef } from 'react';

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
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <foreignObject x={props.x} y={props.y} width={props.w} height={props.h} className="binput">
      <input
        ref={ref}
        defaultValue={props.initial ?? ''}
        placeholder={props.placeholder}
        maxLength={80}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            const text = event.currentTarget.value.trim();
            if (text === '') props.onCancel();
            else props.onCommit(text);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          }
        }}
        onBlur={(event) => {
          const text = event.currentTarget.value.trim();
          if (text === '') props.onCancel();
          else props.onCommit(text);
        }}
      />
    </foreignObject>
  );
}
