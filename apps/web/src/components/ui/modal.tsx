import { useEffect, type ReactNode } from 'react';
import { UButton } from './button.js';

export function UModal(props: {
  title?: string;
  wide?: boolean;
  xl?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [props]);

  const size = props.xl ? 'xl' : props.wide ? 'wide' : '';

  return (
    <div
      className="modal-wrap"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className={size === '' ? 'modal' : `modal ${size}`} role="dialog" aria-modal="true" aria-label={props.title}>
        {props.title ? <h4>{props.title}</h4> : null}
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}

export function UConfirm(props: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <UModal title={props.title} onClose={props.onCancel}>
      <p>{props.body}</p>
      <div className="ft">
        <UButton onClick={props.onCancel}>取消</UButton>
        <UButton variant={props.danger ? 'danger' : 'primary'} disabled={props.busy} onClick={props.onConfirm}>
          {props.confirmLabel}
        </UButton>
      </div>
    </UModal>
  );
}
