import { todayResponseSchema } from '@unfold/dto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

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

describe('today', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects /api/today without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/today' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });

  it('returns a today aggregate after login', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/today',
      headers: { cookie: cookiePair(login.headers['set-cookie']) },
    });
    expect(res.statusCode).toBe(200);
    const body: unknown = res.json();
    const today = todayResponseSchema.parse(body);
    expect(today.due).toEqual([]);
  });
});
