import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, createPool } from '../db/client.js';
import { collections, users } from '../db/schema.js';
import { MAX_AVATAR_BYTES } from './upload.js';
import type { AvatarStore } from './store.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const gif = Buffer.from('R0lGODdhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs=', 'base64');

class MemoryAvatarStore implements AvatarStore {
  objects = new Map<string, Buffer>();

  async put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, bytes);
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async url(key: string): Promise<string> {
    return `https://img.test/${key}?sign=x`;
  }
}

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('missing set-cookie');
  const pair = header.split(';')[0];
  if (!pair) throw new Error('missing set-cookie');
  return pair;
}

describe('avatar', () => {
  let app: FastifyInstance;
  let cookie: string;
  const store = new MemoryAvatarStore();
  const createdUsernames: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ avatarStore: store });
    const name = `u${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    createdUsernames.push(name);
    const res = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username: name, password: 'secret-88' },
    });
    expect(res.statusCode).toBe(201);
    cookie = cookiePair(res.headers['set-cookie']);
  });

  afterAll(async () => {
    await app.close();
    const pool = createPool();
    try {
      const db = createDb(pool);
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.username, createdUsernames));
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        await db.delete(collections).where(inArray(collections.userId, ids));
        await db.delete(users).where(inArray(users.id, ids));
      }
    } finally {
      await pool.end();
    }
  });

  async function avatarRequest(
    file: { filename: string; type: string; bytes: Buffer },
    withCookie = true,
  ) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
    const encoded = new Response(form);
    const contentType = encoded.headers.get('content-type');
    if (!contentType) throw new Error('missing content-type');
    return app.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      payload: Buffer.from(await encoded.arrayBuffer()),
      headers: {
        ...(withCookie ? { cookie } : {}),
        'content-type': contentType,
      },
    });
  }

  it('uploads, replaces and removes the avatar', async () => {
    const put = await avatarRequest({ filename: 'a.png', type: 'image/png', bytes: png });
    expect(put.statusCode).toBe(200);
    const firstUrl = put.json().avatarUrl as string;
    expect(firstUrl.startsWith('https://img.test/avatars/')).toBe(true);
    expect(store.objects.size).toBe(1);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().avatarUrl).toContain('/avatars/');

    const again = await avatarRequest({ filename: 'b.gif', type: 'image/gif', bytes: gif });
    expect(again.statusCode).toBe(200);
    expect(again.json().avatarUrl).not.toBe(firstUrl);
    expect(store.objects.size).toBe(1);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/me/avatar',
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);
    expect(store.objects.size).toBe(0);

    const after = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(after.json().avatarUrl).toBeNull();
  });

  it('rejects a non-image upload', async () => {
    const res = await avatarRequest({ filename: 'a.txt', type: 'text/plain', bytes: Buffer.from('hi') });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: 'invalid_body',
      message: '头像只能是 JPEG、PNG、WebP 或 GIF',
    });
  });

  it('rejects an oversize upload', async () => {
    const big = Buffer.alloc(MAX_AVATAR_BYTES + 1);
    const res = await avatarRequest({ filename: 'big.png', type: 'image/png', bytes: big });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('头像不能超过 5 MB');
  });

  it('requires a session', async () => {
    const res = await avatarRequest({ filename: 'a.png', type: 'image/png', bytes: png }, false);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });
});
