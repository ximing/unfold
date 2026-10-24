import { Service } from '@rabjs/react';
import { todayResponseSchema, type TodayResponse } from '@unfold/dto';

export class SessionService extends Service {
  username: string | null = null;
  today: TodayResponse | null = null;
  error = '';
  ready = false;

  async restore(): Promise<boolean> {
    const res = await fetch('/api/me', { credentials: 'include' });
    this.ready = true;
    if (!res.ok) {
      this.username = null;
      return false;
    }
    const body = (await res.json()) as { username: string };
    this.username = body.username;
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
    this.today = null;
    this.error = '';
  }

  async loadToday(): Promise<void> {
    const res = await fetch('/api/today', { credentials: 'include' });
    if (res.status === 401) {
      this.username = null;
      this.ready = true;
      return;
    }
    if (!res.ok) {
      this.error = '今天的页面没有加载出来';
      return;
    }
    this.today = todayResponseSchema.parse(await res.json());
  }

  async exportPackage(): Promise<void> {
    const res = await fetch('/api/export', { credentials: 'include' });
    if (res.status === 401) {
      this.username = null;
      this.ready = true;
      return;
    }
    if (!res.ok) {
      this.error = '导出没有完成';
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'unfold-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }
}
