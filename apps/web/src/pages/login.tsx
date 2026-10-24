import { observer, useService } from '@rabjs/react';
import { type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { SessionService } from '../services/session.service.js';

export const LoginPage = observer(function LoginPage() {
  const session = useService(SessionService);
  const navigate = useNavigate();

  if (session.username) return <Navigate to="/today" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = data.get('username');
    const password = data.get('password');
    const ok = await session.login(
      typeof username === 'string' ? username : '',
      typeof password === 'string' ? password : '',
    );
    if (ok) navigate('/today');
  }

  return (
    <main className="shell">
      <h1>Unfold</h1>
      <p className="muted">进入你的知识星图。</p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label>
          用户名
          <input name="username" autoComplete="username" />
        </label>
        <label>
          密码
          <input name="password" type="password" autoComplete="current-password" />
        </label>
        {session.error ? <p role="alert">{session.error}</p> : null}
        <button type="submit">进入</button>
      </form>
    </main>
  );
});
