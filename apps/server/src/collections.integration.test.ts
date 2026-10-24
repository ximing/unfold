import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { collectionListSchema, collectionSchema, domainSchema } from '@unfold/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { collections, documents, domains } from './db/schema.js';

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

describe('collections', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const suffix = Date.now();
  const domainName = `领域-${suffix}`;
  const otherDomainName = `领域-b-${suffix}`;
  const rootTitle = `c-${suffix}`;
  const secondTitle = `b-${suffix}`;
  const childTitle = `a-${suffix}`;
  const otherTitle = `z-${suffix}`;
  const domainIds: string[] = [];
  const collectionIds: string[] = [];
  let domainId = '';
  let otherDomainId = '';
  let rootId = '';
  let secondId = '';
  let childId = '';

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
    if (collectionIds.length > 0) {
      await db
        .update(collections)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(collections.id, collectionIds));
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(documents.ownerType, 'collection'), inArray(documents.ownerId, collectionIds)));
    }
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  it('rejects POST /api/collections without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections',
      payload: { domainId: randomUUID(), title: rootTitle },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json())).toEqual({ code: 'unauthenticated', message: '未登录' });
  });

  it('creates a root collection with an empty document', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    domainId = domain.id;
    domainIds.push(domain.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId, title: rootTitle },
    });
    expect(res.statusCode).toBe(201);
    const created = collectionSchema.parse(res.json());
    expect(created.intent).toBe('');
    expect(created.position).toBe(0);
    expect(created.parentCollectionId).toBeNull();
    expect(created.documentId).not.toBeNull();
    expect(created.domainId).toBe(domainId);
    expect(created.title).toBe(rootTitle);
    rootId = created.id;
    collectionIds.push(created.id);
    if (!created.documentId) return;

    const docs = await db
      .select({
        ownerType: documents.ownerType,
        ownerId: documents.ownerId,
        schemaVersion: documents.schemaVersion,
        contentJson: documents.contentJson,
        plainText: documents.plainText,
      })
      .from(documents)
      .where(eq(documents.id, created.documentId))
      .limit(1);
    expect(docs[0]).toEqual({
      ownerType: 'collection',
      ownerId: rootId,
      schemaVersion: SCHEMA_VERSION,
      contentJson: { type: 'doc', content: [] },
      plainText: '',
    });

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/collections/${rootId}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(200);
    expect(collectionSchema.parse(fetched.json())).toEqual(created);
  });

  it('places the next root collection at position 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId, title: secondTitle },
    });
    expect(res.statusCode).toBe(201);
    const created = collectionSchema.parse(res.json());
    expect(created.position).toBe(1);
    expect(created.parentCollectionId).toBeNull();
    secondId = created.id;
    collectionIds.push(created.id);
  });

  it('creates a child collection under the first root', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId, title: childTitle, parentCollectionId: rootId },
    });
    expect(res.statusCode).toBe(201);
    const created = collectionSchema.parse(res.json());
    expect(created.parentCollectionId).toBe(rootId);
    expect(created.position).toBe(0);
    childId = created.id;
    collectionIds.push(created.id);
  });

  it('rejects a collection nested under a child', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId, title: `deep-${suffix}`, parentCollectionId: childId },
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_nesting', message: '合集最多嵌套一层' });
  });

  it('rejects a child whose domain differs from its parent', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: otherDomainName },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    otherDomainId = domain.id;
    domainIds.push(domain.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: {
        domainId: otherDomainId,
        title: `mismatch-${suffix}`,
        parentCollectionId: rootId,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res.json())).toEqual({
      code: 'domain_mismatch',
      message: '子合集要和父合集在同一个领域',
    });
  });

  it('lists only collections in the domain ordered by position', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId: otherDomainId, title: otherTitle },
    });
    expect(created.statusCode).toBe(201);
    const other = collectionSchema.parse(created.json());
    collectionIds.push(other.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/collections?domainId=${domainId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = collectionListSchema.parse(res.json());
    expect(body.collections.map((item) => item.id)).toEqual([childId, rootId, secondId]);
    expect(body.collections.map((item) => item.position)).toEqual([0, 0, 1]);
    expect(body.collections.every((item) => item.domainId === domainId)).toBe(true);
    expect(body.collections.some((item) => item.id === other.id)).toBe(false);
  });

  it('returns 404 for an unknown collection', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/collections/${randomUUID()}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json())).toEqual({ code: 'not_found', message: '没有这个合集' });
  });

  it('rejects a blank title', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId, title: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_body', message: '请求格式不正确' });
  });
});
