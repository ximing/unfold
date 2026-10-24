import { domainListSchema, domainSchema, normalizeName, objectSummarySchema, todayResponseSchema } from '@unfold/dto';
import { eq, inArray } from 'drizzle-orm';
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

describe('objects', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let todayBefore = 0;
  let pendingBefore = 0;
  const suffix = Date.now();
  const domainNameA = `领域-${suffix}`;
  const domainNameB = `领域-b-${suffix}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let domainAId = '';
  let firstId = '';
  let secondId = '';

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
    const today = await app.inject({
      method: 'GET',
      url: '/api/today',
      headers: { cookie },
    });
    expect(today.statusCode).toBe(200);
    const before = todayResponseSchema.parse(today.json());
    todayBefore = before.freeCount;
    pendingBefore = before.pendingSuggestions;
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

  it('rejects POST /api/domains without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { name: domainNameA },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json()).code).toBe('unauthenticated');
  });

  it('rejects an empty domain body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json()).code).toBe('invalid_body');
  });

  it('creates a domain with freeCount 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainNameA },
    });
    expect(res.statusCode).toBe(201);
    const body: unknown = res.json();
    const domain = domainSchema.parse(body);
    expect(domain.freeCount).toBe(0);
    expect(domain.name).toBe(domainNameA);
    domainAId = domain.id;
    domainIds.push(domain.id);
  });

  it('rejects a duplicate domain name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainNameA },
    });
    expect(res.statusCode).toBe(409);
    const error = errorOf(res.json());
    expect(error.code).toBe('duplicate_name');
    expect(error.message).toBe('已经有这个领域');
  });

  it('creates a concept in the domain', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domainAId,
        type: 'concept',
        canonicalName: '状态等价',
        coreStatement: '重复子问题合成同一状态',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = objectSummarySchema.parse(res.json());
    expect(created.coreVersion).toBe(1);
    expect(created.normalizedName).toBe(normalizeName('状态等价'));
    expect(created.domainName).toBe(domainNameA);
    expect(created.coreStatement).toBe('重复子问题合成同一状态');
    firstId = created.id;
    objectIds.push(created.id);
  });

  it('rejects a normalized duplicate name in the same domain', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domainAId,
        type: 'concept',
        canonicalName: ' 状态等价 ',
        coreStatement: '另一个陈述',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res.json()).message).toBe('这个领域里已经有同名的点');
  });

  it('creates an object with an empty core statement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domainAId,
        type: 'concept',
        canonicalName: '空陈述',
        coreStatement: '',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = objectSummarySchema.parse(res.json());
    expect(created.coreStatement).toBe('');
    secondId = created.id;
    objectIds.push(created.id);
  });

  it('allows the same canonical name in another domain', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainNameB },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    domainIds.push(domain.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domain.id,
        type: 'concept',
        canonicalName: '状态等价',
        coreStatement: '另一个领域的同名点',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = objectSummarySchema.parse(res.json());
    expect(created.domainName).toBe(domainNameB);
    objectIds.push(created.id);
  });

  it('counts free objects per domain', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/domains',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = domainListSchema.parse(res.json());
    const first = body.domains.find((domain) => domain.name === domainNameA);
    const second = body.domains.find((domain) => domain.name === domainNameB);
    expect(first?.freeCount).toBe(2);
    expect(second?.freeCount).toBe(1);
  });

  it('lists a domain’s objects oldest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects?domainId=${domainAId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body: unknown = res.json();
    if (!body || typeof body !== 'object' || !('objects' in body)) {
      throw new Error('missing objects');
    }
    const objects = objectSummarySchema.array().parse(body.objects);
    expect(objects.map((object) => object.id)).toEqual([firstId, secondId]);
  });

  it('returns one object and rejects a non-uuid id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${firstId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const one = objectSummarySchema.parse(res.json());
    expect(one.id).toBe(firstId);
    expect(one.canonicalName).toBe('状态等价');

    const missing = await app.inject({
      method: 'GET',
      url: '/api/objects/not-a-uuid',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(errorOf(missing.json()).message).toBe('没有这个点');
  });

  it('increases today freeCount by the three new objects', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/today',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const today = todayResponseSchema.parse(res.json());
    expect(today.freeCount).toBe(todayBefore + 3);
    if (!today.focus) throw new Error('missing focus');
    expect(objectIds).toContain(today.focus.id);
    expect(today.due).toEqual([]);
    expect(today.pendingSuggestions).toBe(pendingBefore);
    expect(today.openQuestions.filter((question) => objectIds.includes(question.objectId))).toEqual([]);
  });

  it('adds an alias without bumping coreVersion', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/objects/${firstId}`,
      headers: { cookie },
      payload: { aliases: ['别名甲'] },
    });
    expect(res.statusCode).toBe(200);
    const updated = objectSummarySchema.parse(res.json());
    expect(updated.coreVersion).toBe(1);
    expect(updated.aliases).toEqual(['别名甲']);
  });

  it('bumps coreVersion when the core statement changes', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/objects/${firstId}`,
      headers: { cookie },
      payload: { coreStatement: '新的陈述' },
    });
    expect(res.statusCode).toBe(200);
    const updated = objectSummarySchema.parse(res.json());
    expect(updated.coreVersion).toBe(2);
    expect(updated.coreStatement).toBe('新的陈述');
    expect(updated.aliases).toEqual(['别名甲']);
  });

  it('rejects an alias that already names another object', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/objects/${secondId}`,
      headers: { cookie },
      payload: { aliases: ['状态等价'] },
    });
    expect(res.statusCode).toBe(409);
    const error = errorOf(res.json());
    expect(error.code).toBe('duplicate_alias');
    expect(error.message).toBe('这个称呼已经指向另一个点');

    const again = await app.inject({
      method: 'GET',
      url: `/api/objects/${secondId}`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(200);
    expect(objectSummarySchema.parse(again.json()).aliases).toEqual([]);
  });

  it('stores an empty document on the first object', async () => {
    const rows = await db
      .select({ documentId: knowledgeObjects.documentId })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, firstId))
      .limit(1);
    const documentId = rows[0]?.documentId;
    expect(documentId).toBeTruthy();
    if (!documentId) return;

    const docs = await db
      .select({
        ownerType: documents.ownerType,
        ownerId: documents.ownerId,
        schemaVersion: documents.schemaVersion,
        contentJson: documents.contentJson,
        plainText: documents.plainText,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    expect(docs[0]).toEqual({
      ownerType: 'object',
      ownerId: firstId,
      schemaVersion: 1,
      contentJson: { type: 'doc', content: [] },
      plainText: '',
    });
  });
});
