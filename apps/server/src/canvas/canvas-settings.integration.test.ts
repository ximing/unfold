import { randomUUID } from 'node:crypto';
import { defaultCanvasPrefs, defaultEdgeAppearance, type CanvasPrefs } from '@unfold/dto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
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

function errorOf(body: { error?: { code?: string; message?: string } }) {
  return body.error ?? { code: '', message: '' };
}

describe('canvas settings', () => {
  let app: FastifyInstance;
  let cookie: string;
  let originalCanvas: CanvasPrefs = { ...defaultCanvasPrefs };
  const created: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    originalCanvas = { ...defaultCanvasPrefs, ...(me.json().canvas as Partial<CanvasPrefs>) };
  });

  afterAll(async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/me/canvas',
      headers: { cookie },
      payload: originalCanvas,
    });
    for (const id of created) {
      await app.inject({ method: 'DELETE', url: `/api/collections/${id}`, headers: { cookie } });
    }
    await app.close();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
    withCookie = true,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method,
      url,
      payload,
      headers: withCookie ? { cookie } : {},
    });
  }

  it('reads and updates account canvas prefs', async () => {
    const me = await call('GET', '/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().canvas).toEqual(originalCanvas);

    const next = {
      route: 'orthogonal',
      grid: false,
      snap: true,
      labels: 'focus',
      markers: false,
      minimap: false,
      grow: 'up',
    };
    const patched = await call('PATCH', '/api/me/canvas', next);
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual(next);
    expect((await call('GET', '/api/me')).json().canvas).toEqual(next);

    const bad = await call('PATCH', '/api/me/canvas', { ...next, route: 'arc' });
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad.json())).toEqual({ code: 'invalid_body', message: '请求不正确' });

    const badGrow = await call('PATCH', '/api/me/canvas', { ...next, grow: 'sideways' });
    expect(badGrow.statusCode).toBe(400);
    expect(errorOf(badGrow.json()).code).toBe('invalid_body');

    const anon = await call('PATCH', '/api/me/canvas', next, false);
    expect(anon.statusCode).toBe(401);
    expect(errorOf(anon.json()).code).toBe('unauthenticated');
  });

  it('keeps edge appearance on one collection', async () => {
    const token = randomUUID().replaceAll('-', '').slice(0, 8);
    const first = await call('POST', '/api/collections', { title: `外观甲${token}` });
    const second = await call('POST', '/api/collections', { title: `外观乙${token}` });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const idA = (first.json() as { id: string }).id;
    const idB = (second.json() as { id: string }).id;
    created.push(idA, idB);

    const look = { dash: 'dashed', width: 'thick', color: 'red', arrow: 'none' };
    const patched = await call('PATCH', `/api/collections/${idA}/appearance`, look);
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual(look);

    const graphA = await call('GET', `/api/collections/${idA}/graph`);
    const graphB = await call('GET', `/api/collections/${idB}/graph`);
    expect(graphA.json().appearance).toEqual(look);
    expect(graphB.json().appearance).toEqual(defaultEdgeAppearance);

    const bad = await call('PATCH', `/api/collections/${idA}/appearance`, { ...look, color: 'purple' });
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad.json()).code).toBe('invalid_body');
    expect((await call('GET', `/api/collections/${idA}/graph`)).json().appearance).toEqual(look);

    const title = await call('PATCH', `/api/collections/${idA}`, { title: `外观甲${token}`, dash: 'dotted' });
    expect(title.statusCode).toBe(400);

    const missing = await call('PATCH', `/api/collections/${randomUUID()}/appearance`, look);
    expect(missing.statusCode).toBe(404);
    expect(errorOf(missing.json()).code).toBe('not_found');

    const anon = await call('PATCH', `/api/collections/${idA}/appearance`, look, false);
    expect(anon.statusCode).toBe(401);
    expect(errorOf(anon.json()).code).toBe('unauthenticated');
  });
});
