import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from './session.service.js';

describe('SessionService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('登录请求断开时不改用户名', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const session = new SessionService();
    session.username = 'ada';
    await expect(session.login('ada', 'secret')).resolves.toBe(false);
    expect(session.error).toBe('网络没有连上');
    expect(session.username).toBe('ada');
  });

  it('登出请求断开时保留用户名', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const session = new SessionService();
    session.username = 'ada';
    await expect(session.logout()).resolves.toBe(false);
    expect(session.username).toBe('ada');
    expect(session.error).toBe('网络没有连上');
  });
});
