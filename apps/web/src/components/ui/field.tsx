import { useEffect, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

export function UField(props: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={props.htmlFor}>{props.label}</label>
      {props.children}
      {props.error ? <p className="err">{props.error}</p> : props.hint ? <p className="hint">{props.hint}</p> : null}
    </div>
  );
}

type UTextInputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function UTextInput({ invalid = false, className = '', ...rest }: UTextInputProps) {
  const names = invalid ? `tf err-b ${className}`.trim() : `tf ${className}`.trim();
  return <input className={names} {...rest} />;
}

type UTextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
  autoGrow?: boolean;
};

export function UTextArea({ invalid = false, autoGrow = true, className = '', ...rest }: UTextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = typeof rest.value === 'string' ? rest.value : '';

  useEffect(() => {
    if (!autoGrow) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autoGrow, value]);

  const names = invalid ? `tf err-b ${className}`.trim() : `tf ${className}`.trim();
  return <textarea ref={ref} className={names} rows={rest.rows ?? 2} {...rest} />;
}
