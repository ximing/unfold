import { Service } from '@rabjs/react';

export class SessionService extends Service {
  username: string | null = null;
  error = '';
  ready = false;

  async restore(): Promise<boolean> {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) {
      this.username = null;
      this.ready = true;
      return false;
    }
    const body = (await res.json()) as { username: string };
    this.username = body.username;
    this.ready = true;
    return true;
  }

  async login(username: string, password: string): Promise<boolean> {
    this.error = '';
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      this.error = '用户名或密码不正确';
      return false;
    }
    const body = (await res.json()) as { username: string };
    this.username = body.username;
    this.ready = true;
    return true;
  }

  async logout(): Promise<void> {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    this.username = null;
    this.error = '';
  }
}
