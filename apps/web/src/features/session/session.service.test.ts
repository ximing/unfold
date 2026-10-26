import { defaultCanvasPrefs } from '@unfold/dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from './session.service.js';

function account(username: string, avatarUrl: string | null = null): string {
  return JSON.stringify({ username, avatarUrl, canvas: defaultCanvasPrefs });
}

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

  it('恢复会话时读出头象地址', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(account('ada', 'https://img.test/a.png'), { status: 200 }),
      ),
    );
    const session = new SessionService();
    await expect(session.restore()).resolves.toBe(true);
    expect(session.username).toBe('ada');
    expect(session.avatarUrl).toBe('https://img.test/a.png');
  });

  it('注册成功后直接进入会话', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(account('ada'), { status: 201 }),
      ),
    );
    const session = new SessionService();
    await expect(session.register('ada', 'secret-88')).resolves.toBe(true);
    expect(session.username).toBe('ada');
    expect(session.avatarUrl).toBeNull();
    expect(session.ready).toBe(true);
  });

  it('注册重名时展示服务端文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'conflict', message: '这个用户名已经被用了' } }), { status: 409 }),
      ),
    );
    const session = new SessionService();
    await expect(session.register('ada', 'secret-88')).resolves.toBe(false);
    expect(session.error).toBe('这个用户名已经被用了');
    expect(session.username).toBeNull();
  });

  it('改名成功后更新用户名', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(account('ada2'), { status: 200 }),
      ),
    );
    const session = new SessionService();
    session.username = 'ada';
    await expect(session.rename('ada2')).resolves.toBe(true);
    expect(session.username).toBe('ada2');
  });

  it('上传头象后更新地址，移除后清空', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ avatarUrl: 'https://img.test/b.png' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = new SessionService();
    session.username = 'ada';

    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    await expect(session.uploadAvatar(file)).resolves.toBe(true);
    expect(session.avatarUrl).toBe('https://img.test/b.png');

    await expect(session.removeAvatar()).resolves.toBe(true);
    expect(session.avatarUrl).toBeNull();
  });

  it('上传头象失败时展示服务端文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'invalid_body', message: '头像不能超过 5 MB' } }), { status: 400 }),
      ),
    );
    const session = new SessionService();
    const file = new File([new Uint8Array([1])], 'big.png', { type: 'image/png' });
    await expect(session.uploadAvatar(file)).resolves.toBe(false);
    expect(session.error).toBe('头像不能超过 5 MB');
    expect(session.avatarUrl).toBeNull();
  });

  it('画布看法失败时回到写入前，并且不写账号错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const session = new SessionService();
    session.canvas = { ...defaultCanvasPrefs, grid: true };
    await expect(session.updateCanvas({ grid: false })).resolves.toBe('fail');
    expect(session.canvas.grid).toBe(true);
    expect(session.canvasError).toBe('网络没有连上');
    expect(session.error).toBe('');
  });

  it('后发出的画布看法不会被先发出的响应盖住', async () => {
    let releaseFirst: (value: Response) => void = () => {};
    const first = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        if (calls === 1) return first;
        return Promise.resolve(
          new Response(JSON.stringify({ ...defaultCanvasPrefs, route: 'curve' }), { status: 200 }),
        );
      }),
    );
    const session = new SessionService();
    const older = session.updateCanvas({ route: 'orthogonal' });
    const newer = session.updateCanvas({ route: 'curve' });
    releaseFirst(new Response(JSON.stringify({ ...defaultCanvasPrefs, route: 'orthogonal' }), { status: 200 }));
    await older;
    await expect(newer).resolves.toBe('ok');
    expect(session.canvas.route).toBe('curve');
    expect(session.canvasError).toBe('');
    expect(session.error).toBe('');
  });
});
