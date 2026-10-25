import { observer, useService } from '@rabjs/react';
import { type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { UButton } from '../../shared/ui/button/button.js';
import { UField, UTextInput } from '../../shared/ui/field/field.js';
import { SessionService } from './session.service.js';
import './login.css';

export const LoginPage = observer(function LoginPage() {
  const session = useService(SessionService);
  const navigate = useNavigate();

  if (session.username) return <Navigate to="/library" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = data.get('username');
    const password = data.get('password');
    const ok = await session.login(
      typeof username === 'string' ? username : '',
      typeof password === 'string' ? password : '',
    );
    if (ok) navigate('/library');
  }

  return (
    <main className="login-gate">
      <form className="login-card" onSubmit={(event) => void onSubmit(event)}>
        <div className="login-mark">展</div>
        <h1>Unfold</h1>
        <p className="lede">进入你的知识星图。</p>
        <UField label="用户名" htmlFor="login-username">
          <UTextInput id="login-username" name="username" autoComplete="username" />
        </UField>
        <UField label="密码" htmlFor="login-password">
          <UTextInput id="login-password" name="password" type="password" autoComplete="current-password" />
        </UField>
        {session.error ? <p role="alert">{session.error}</p> : null}
        <UButton variant="primary" size="big" type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
          进入
        </UButton>
      </form>
    </main>
  );
});
