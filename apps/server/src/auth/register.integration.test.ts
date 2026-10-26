import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, createPool } from '../db/client.js';
import { users } from '../db/schema.js';

const seedUsername = process.env.SEED_USERNAME;
if (!seedUsername) throw new Error('SEED_USERNAME is not set');

const createdUsernames: string[] = [];

function freshUsername(): string {
  const name = `u${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  createdUsernames.push(name);
  return name;
}

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('missing set-cookie');
  const pair = header.split(';')[0];
  if (!pair) throw new Error('missing set-cookie');
  return pair;
}

describe('register', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    const pool = createPool();
    try {
      await createDb(pool).delete(users).where(inArray(users.username, createdUsernames));
    } finally {
      await pool.end();
    }
  });

  it('registers and signs in immediately', async () => {
    const name = freshUsername();
    const res = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username: name, password: 'secret-88' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ username: name, avatarUrl: null });

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookiePair(res.headers['set-cookie']) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ username: name, avatarUrl: null });

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: name, password: 'secret-88' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().username).toBe(name);
  });

  it('rejects a taken username with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username: seedUsername, password: 'secret-88' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
  });

  it('rejects invalid bodies with the shared messages', async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username: freshUsername(), password: 'short' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toEqual({ code: 'invalid_body', message: '密码至少 8 位' });

    const spaced = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username: 'a b', password: 'secret-88' },
    });
    expect(spaced.statusCode).toBe(400);
    expect(spaced.json().error.message).toBe('用户名里不能有空格');
  });

  it('renames the account and rejects a taken name', async () => {
    const name = freshUsername();
    const res = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username: name, password: 'secret-88' },
    });
    const cookie = cookiePair(res.headers['set-cookie']);

    const renamed = freshUsername();
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/me/username',
      payload: { username: renamed },
      headers: { cookie },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().username).toBe(renamed);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: name, password: 'secret-88' },
    });
    expect(oldLogin.statusCode).toBe(401);
    expect(oldLogin.json().error.code).toBe('invalid_credentials');

    const taken = await app.inject({
      method: 'PATCH',
      url: '/api/me/username',
      payload: { username: seedUsername },
      headers: { cookie },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('conflict');

    const anon = await app.inject({
      method: 'PATCH',
      url: '/api/me/username',
      payload: { username: freshUsername() },
    });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe('unauthenticated');
  });
});
