import { Service } from '@rabjs/react';
import { accountSchema, errorBodySchema } from '@unfold/dto';

export class SessionService extends Service {
  username: string | null = null;
  avatarUrl: string | null = null;
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

  private apply(body: { username: string; avatarUrl: string | null }) {
    this.username = body.username;
    this.avatarUrl = body.avatarUrl;
  }

  private async parseAccount(res: Response): Promise<boolean> {
    const parsed = accountSchema.safeParse(await res.json());
    if (!parsed.success) return false;
    this.apply(parsed.data);
    this.ready = true;
    return true;
  }

  /** 失败时取服务端文案，取不到用兜底。 */
  private async fail(res: Response, fallback: string): Promise<false> {
    try {
      const parsed = errorBodySchema.safeParse(await res.json());
      this.error = parsed.success && parsed.data.error.message !== '' ? parsed.data.error.message : fallback;
    } catch {
      this.error = fallback;
    }
    return false;
  }

  async restore(): Promise<boolean> {
    const res = await this.send('/api/me', { credentials: 'include' });
    if (!res || !res.ok) {
      this.username = null;
      this.avatarUrl = null;
      this.ready = true;
      return false;
    }
    return this.parseAccount(res);
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
    return this.parseAccount(res);
  }

  async register(username: string, password: string): Promise<boolean> {
    this.error = '';
    const res = await this.send('/api/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    if (!res.ok) return this.fail(res, '注册没有成功');
    return this.parseAccount(res);
  }

  async rename(username: string): Promise<boolean> {
    this.error = '';
    const res = await this.send('/api/me/username', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    if (!res.ok) return this.fail(res, '用户名没有改成功');
    return this.parseAccount(res);
  }

  async uploadAvatar(file: File): Promise<boolean> {
    this.error = '';
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await this.send('/api/me/avatar', {
      method: 'PUT',
      credentials: 'include',
      body: form,
    });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    if (!res.ok) return this.fail(res, '头像没有换成功');
    const body = (await res.json()) as { avatarUrl: string };
    this.avatarUrl = body.avatarUrl;
    return true;
  }

  async removeAvatar(): Promise<boolean> {
    this.error = '';
    const res = await this.send('/api/me/avatar', { method: 'DELETE', credentials: 'include' });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    if (!res.ok) return this.fail(res, '头像没有移除');
    this.avatarUrl = null;
    return true;
  }

  async logout(): Promise<boolean> {
    const res = await this.send('/api/logout', { method: 'POST', credentials: 'include' });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    this.username = null;
    this.avatarUrl = null;
    this.error = '';
    return true;
  }
}
