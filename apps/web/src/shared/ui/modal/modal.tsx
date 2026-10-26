import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { UButton } from '../button/button.js';
import './modal.css';

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

  // 检查器的 backdrop-filter 会把 fixed 弹层困在面板里，挂到 body 才盖住整页。
  return createPortal(
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
    </div>,
    document.body,
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
