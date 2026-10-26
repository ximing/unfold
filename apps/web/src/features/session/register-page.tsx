import { observer, useService } from '@rabjs/react';
import { type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { UButton } from '../../shared/ui/button/button.js';
import { UField, UTextInput } from '../../shared/ui/field/field.js';
import { SessionService } from './session.service.js';
import './login.css';

export const RegisterPage = observer(function RegisterPage() {
  const session = useService(SessionService);
  const navigate = useNavigate();

  if (session.username) return <Navigate to="/library" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = data.get('username');
    const password = data.get('password');
    const confirm = data.get('confirm');
    if (password !== confirm) {
      session.error = '两次密码不一样';
      return;
    }
    const ok = await session.register(
      typeof username === 'string' ? username : '',
      typeof password === 'string' ? password : '',
    );
    if (ok) navigate('/library');
  }

  return (
    <main className="login-gate">
      <form className="login-card" onSubmit={(event) => void onSubmit(event)}>
        <div className="login-mark">展</div>
        <h1>注册 Unfold</h1>
        <p className="lede">开一个自己的知识星图。</p>
        <UField label="用户名" htmlFor="register-username">
          <UTextInput id="register-username" name="username" autoComplete="username" />
        </UField>
        <UField label="密码" htmlFor="register-password">
          <UTextInput id="register-password" name="password" type="password" autoComplete="new-password" />
        </UField>
        <UField label="再输一次密码" htmlFor="register-confirm">
          <UTextInput id="register-confirm" name="confirm" type="password" autoComplete="new-password" />
        </UField>
        {session.error ? <p role="alert">{session.error}</p> : null}
        <UButton variant="primary" size="big" type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
          注册并进入
        </UButton>
        <p className="login-alt">
          已有账号？<Link to="/login">去登录</Link>
        </p>
      </form>
    </main>
  );
});
