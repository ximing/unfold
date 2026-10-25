import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('missing set-cookie');
  const pair = header.split(';')[0];
  if (!pair) throw new Error('missing set-cookie');
  return pair;
}

describe('auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password: `${password}-wrong` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_credentials');
  });

  it('sets a session cookie for the seed user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(process.env.SEED_USERNAME);
    const setCookie = res.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toMatch(/(?:^|;)\s*Secure(?:;|$)/i);
  });

  it('rejects /api/me without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });

  it('returns the username when the session cookie is present', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookiePair(login.headers['set-cookie']) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(username);
  });

  it('clears the session on logout', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    const logout = await app.inject({
      method: 'POST',
      url: '/api/logout',
      headers: { cookie: cookiePair(login.headers['set-cookie']) },
    });
    expect(logout.statusCode).toBe(204);
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: cookiePair(logout.headers['set-cookie']) },
    });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('unauthenticated');
  });
});
