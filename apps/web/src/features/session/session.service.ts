import { Service } from '@rabjs/react';
import type { CanvasPrefs } from '@unfold/dto';
import { accountSchema, canvasPrefsSchema, defaultCanvasPrefs, errorBodySchema } from '@unfold/dto';

export class SessionService extends Service {
  username: string | null = null;
  avatarUrl: string | null = null;
  canvas: CanvasPrefs = { ...defaultCanvasPrefs };
  /** 画布看法写入失败。不写到 error，避免出现在账号菜单里。 */
  canvasError = '';
  error = '';
  ready = false;
  private canvasTicket = 0;

  /** 网络断开时返回 null。不写 error，避免过期请求盖住新请求。 */
  private async send(input: string, init?: RequestInit): Promise<Response | null> {
    try {
      return await fetch(input, init);
    } catch {
      return null;
    }
  }

  private apply(body: { username: string; avatarUrl: string | null; canvas: CanvasPrefs }) {
    this.username = body.username;
    this.avatarUrl = body.avatarUrl;
    this.canvas = body.canvas;
    this.canvasError = '';
  }

  private async readError(res: Response, fallback: string): Promise<string> {
    try {
      const parsed = errorBodySchema.safeParse(await res.json());
      if (parsed.success && parsed.data.error.message !== '') return parsed.data.error.message;
    } catch {
      // 响应不是错误体
    }
    return fallback;
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
    this.error = await this.readError(res, fallback);
    return false;
  }

  async restore(): Promise<boolean> {
    const res = await this.send('/api/me', { credentials: 'include' });
    if (!res || !res.ok) {
      this.username = null;
      this.avatarUrl = null;
      this.canvas = { ...defaultCanvasPrefs };
      this.canvasError = '';
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

  /**
   * 立刻改看法，再整份写入。返回 stale 时不改当前值。
   * 失败只写 canvasError。
   */
  async updateCanvas(patch: Partial<CanvasPrefs>): Promise<'ok' | 'fail' | 'stale'> {
    const previous = this.canvas;
    const next = { ...this.canvas, ...patch };
    this.canvas = next;
    const ticket = ++this.canvasTicket;
    const res = await this.send('/api/me/canvas', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (ticket !== this.canvasTicket) return 'stale';
    if (!res) {
      this.canvas = previous;
      this.canvasError = '网络没有连上';
      return 'fail';
    }
    if (!res.ok) {
      this.canvas = previous;
      this.canvasError = await this.readError(res, '画布设置没有保存');
      return 'fail';
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      this.canvas = previous;
      this.canvasError = '响应没法读取';
      return 'fail';
    }
    if (ticket !== this.canvasTicket) return 'stale';
    const parsed = canvasPrefsSchema.safeParse(data);
    if (!parsed.success) {
      this.canvas = previous;
      this.canvasError = '响应没法读取';
      return 'fail';
    }
    this.canvas = parsed.data;
    this.canvasError = '';
    return 'ok';
  }

  async logout(): Promise<boolean> {
    const res = await this.send('/api/logout', { method: 'POST', credentials: 'include' });
    if (!res) {
      this.error = '网络没有连上';
      return false;
    }
    this.username = null;
    this.avatarUrl = null;
    this.canvas = { ...defaultCanvasPrefs };
    this.canvasError = '';
    this.error = '';
    return true;
  }
}
