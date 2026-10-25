import { Service } from '@rabjs/react';

export class SessionService extends Service {
  username: string | null = null;
  error = '';
  ready = false;

  /** 网络断开时返回 null。不写 error，避免过期请求盖住新请求。 */
  private async send(input: string, init?: RequestInit): Promise<Response | null> {
    try {
      return await fetch(input, init);
    } catch {
      return null;
    }
  }

  async restore(): Promise<boolean> {
    const res = await this.send('/api/me', { credentials: 'include' });
    if (!res || !res.ok) {
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
    const res = await this.send('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    if (!res.ok) {
      this.error = '用户名或密码不正确';
      return false;
    }
    const body = (await res.json()) as { username: string };
    this.username = body.username;
    this.ready = true;
    return true;
  }

  async logout(): Promise<boolean> {
    const res = await this.send('/api/logout', { method: 'POST', credentials: 'include' });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    this.username = null;
    this.error = '';
    return true;
  }
}
