import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveNoticeSchema } from '@unfold/dto';
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

describe('同一账号的变更通知', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('未登录的连接会被关掉', async () => {
    const ws = await app.injectWS('/api/live?client=550e8400-e29b-41d4-a716-446655440000');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('没有关掉')), 2000);
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });

  it('写入只通知其它页', async () => {
    const clientA = randomUUID();
    const clientB = randomUUID();
    const pageA = await app.injectWS(`/api/live?client=${clientA}`, { headers: { cookie } });
    const pageB = await app.injectWS(`/api/live?client=${clientB}`, { headers: { cookie } });
    const seenA: string[] = [];
    pageA.on('message', (data) => {
      const parsed = liveNoticeSchema.safeParse(JSON.parse(String(data)));
      if (parsed.success) seenA.push(parsed.data.client);
    });
    const heard = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('没有通知')), 4000);
      pageB.on('message', (data) => {
        const parsed = liveNoticeSchema.safeParse(JSON.parse(String(data)));
        if (!parsed.success || parsed.data.client !== clientA) return;
        clearTimeout(timer);
        resolve();
      });
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { title: `同步${randomUUID().slice(0, 8)}` },
      headers: { cookie, 'x-unfold-client': clientA },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    await heard;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seenA).not.toContain(clientA);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/collections/${id}`,
      headers: { cookie, 'x-unfold-client': clientA },
    });
    expect(removed.statusCode).toBe(204);
    pageA.close();
    pageB.close();
  });
});
