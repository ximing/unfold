import { domainSchema, objectSummarySchema } from '@unfold/dto';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { documents, domains, knowledgeObjects } from './db/schema.js';

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

function errorOf(payload: unknown): { code: string; message: string } {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    throw new Error('missing error');
  }
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) {
    throw new Error('missing error');
  }
  if (typeof error.code !== 'string' || typeof error.message !== 'string') {
    throw new Error('missing error');
  }
  return { code: error.code, message: error.message };
}

describe('delete object', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const domainName = `领域-${Date.now()}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let citingId = '';
  let citedId = '';

  beforeAll(async () => {
    app = await buildApp();
    pool = createPool();
    db = createDb(pool);
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    cookie = cookiePair(login.headers['set-cookie']);
  });

  afterAll(async () => {
    const now = new Date();
    if (objectIds.length > 0) {
      await db
        .update(knowledgeObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(knowledgeObjects.id, objectIds));
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(documents.ownerId, objectIds));
    }
    if (domainIds.length > 0) {
      await db
        .update(domains)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  it('rejects DELETE /api/objects/:id without a cookie', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/objects/11111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json()).code).toBe('unauthenticated');
  });

  it('creates a citing object and a cited object', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    domainIds.push(domain.id);

    const citing = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domain.id,
        type: 'concept',
        canonicalName: '引用方',
        coreStatement: '',
      },
    });
    expect(citing.statusCode).toBe(201);
    citingId = objectSummarySchema.parse(citing.json()).id;
    objectIds.push(citingId);

    const cited = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domain.id,
        type: 'concept',
        canonicalName: '被引用',
        coreStatement: '',
      },
    });
    expect(cited.statusCode).toBe(201);
    citedId = objectSummarySchema.parse(cited.json()).id;
    objectIds.push(citedId);
  });

  it('saves an object_ref from the citing document', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/objects/${citingId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        plainText: '引用',
        content: {
          type: 'doc',
          content: [
            {
              type: 'object_ref',
              attrs: { objectId: citedId, label: '被引用' },
            },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects deleting an object that is still referenced', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${citedId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'referenced', message: '还有 1 处引用这个点', count: 1 },
    });
  });

  it('still returns the cited object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${citedId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(objectSummarySchema.parse(res.json()).id).toBe(citedId);
  });

  it('deletes the citing object', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${citingId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('deletes the cited object after the citing document is gone', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${citedId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('returns not found after the cited object is deleted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${citedId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json()).message).toBe('没有这个点');
  });
});
