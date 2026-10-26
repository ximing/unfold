import { observer, useService } from '@rabjs/react';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { SessionService } from '../session/session.service.js';
import { closeOtherPops, onPopClose } from './pop-bus.js';

export const MoreMenu = observer(function MoreMenu() {
  const session = useService(SessionService);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const retriedAvatar = useRef('');
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (!open) return;
    const offPop = onPopClose(() => {
      setOpen(false);
      setRenaming(false);
    });
    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
      setRenaming(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      offPop();
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  function onAvatarError() {
    // 预签名地址过期：重新调 /api/me 取一个新地址，每个地址只重试一次。
    const current = session.avatarUrl;
    if (!current || retriedAvatar.current === current) return;
    retriedAvatar.current = current;
    void session.restore();
  }

  function onPickAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void session.uploadAvatar(file);
  }

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = data.get('username');
    const ok = await session.rename(typeof username === 'string' ? username : '');
    if (ok) setRenaming(false);
  }

  const initial = Array.from(session.username ?? '？')[0] ?? '？';

  return (
    <div className="pop-wrap" ref={rootRef}>
      <button
        type="button"
        className="avatar-btn"
        title="账号"
        aria-label="账号"
        aria-expanded={open}
        onClick={() => {
          if (!open) closeOtherPops();
          setOpen((value) => !value);
        }}
      >
        {session.avatarUrl ? (
          <img className="avatar-img" src={session.avatarUrl} alt="头像" onError={onAvatarError} />
        ) : (
          <span className="avatar-img avatar-text" aria-hidden>
            {initial}
          </span>
        )}
      </button>
      {open ? (
        <div className="dock-pop">
          <div className="account-head">
            {session.avatarUrl ? (
              <img className="account-avatar" src={session.avatarUrl} alt="头像" onError={onAvatarError} />
            ) : (
              <span className="account-avatar account-avatar-text" aria-hidden>
                {initial}
              </span>
            )}
            <span className="account-name">{session.username}</span>
          </div>
          {renaming ? (
            <form className="account-rename" onSubmit={(event) => void onRename(event)}>
              <input
                name="username"
                defaultValue={session.username ?? ''}
                aria-label="新用户名"
                autoFocus
              />
              <button type="submit">保存</button>
              <button type="button" onClick={() => setRenaming(false)}>
                取消
              </button>
            </form>
          ) : null}
          {session.error ? <p className="account-error" role="alert">{session.error}</p> : null}
          <button type="button" onClick={() => fileRef.current?.click()}>
            更换头像
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={onPickAvatar}
          />
          {session.avatarUrl ? (
            <button type="button" onClick={() => void session.removeAvatar()}>
              移除头像
            </button>
          ) : null}
          {!renaming ? (
            <button
              type="button"
              onClick={() => {
                session.error = '';
                setRenaming(true);
              }}
            >
              修改用户名
            </button>
          ) : null}
          <button
            type="button"
            className="danger"
            onClick={() => {
              void session.logout().then((ok) => {
                if (ok) navigate('/login');
              });
            }}
          >
            登出
          </button>
        </div>
      ) : null}
    </div>
  );
});
