import { randomUUID } from 'node:crypto';
import { capabilitySchema, domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { capabilities, capabilityObjects, documents, domains, evidence, knowledgeObjects } from './db/schema.js';

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
  if (!payload || typeof payload !== 'object' || !('error' in payload)) throw new Error('missing error');
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) {
    throw new Error('missing error');
  }
  if (typeof error.code !== 'string' || typeof error.message !== 'string') throw new Error('missing error');
  return { code: error.code, message: error.message };
}

describe('capabilities', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const suffix = Date.now();
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  const capabilityIds: string[] = [];
  let domainId = '';
  let objectA = '';
  let objectB = '';
  let objectC = '';
  let capabilityId = '';

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
    if (capabilityIds.length > 0) {
      await db
        .update(capabilityObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(capabilityObjects.capabilityId, capabilityIds));
      await db
        .update(capabilities)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(capabilities.id, capabilityIds));
    }
    if (objectIds.length > 0) {
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(documents.ownerType, 'object'), inArray(documents.ownerId, objectIds)));
      await db
        .update(knowledgeObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(knowledgeObjects.id, objectIds));
    }
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  it('rejects POST /api/capabilities without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/capabilities',
      payload: { statement: '能解释定义', kind: 'explain', primaryObjectId: randomUUID() },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json())).toEqual({ code: 'unauthenticated', message: '未登录' });
  });

  it('rejects an empty body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/capabilities',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_body', message: '请求格式不正确' });
  });

  it('creates a capability on the primary point and the linked point', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: `能力领域-${suffix}` },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    domainId = domain.id;
    domainIds.push(domain.id);

    async function createObject(name: string): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/objects',
        headers: { cookie },
        payload: {
          domainId,
          type: 'concept',
          canonicalName: name,
          coreStatement: '一句话',
        },
      });
      expect(res.statusCode).toBe(201);
      const object = objectSummarySchema.parse(res.json());
      objectIds.push(object.id);
      return object.id;
    }

    objectA = await createObject(`点A-${suffix}`);
    objectB = await createObject(`点B-${suffix}`);
    objectC = await createObject(`点C-${suffix}`);

    const res = await app.inject({
      method: 'POST',
      url: '/api/capabilities',
      headers: { cookie },
      payload: {
        statement: '能解释定义',
        kind: 'explain',
        primaryObjectId: objectA,
        objectIds: [objectB],
        hints: ['第一级', '第二级'],
      },
    });
    expect(res.statusCode).toBe(201);
    const created = capabilitySchema.parse(res.json());
    capabilityId = created.id;
    capabilityIds.push(created.id);
    expect(created.hintThreshold).toBe(3);
    expect(created.prompt).toBe('');
    expect(created.objectIds).toEqual([objectA, objectB]);
    expect(created.hints).toEqual(['第一级', '第二级']);
    expect('evidence' in created).toBe(false);
  });

  it('lists the capability for both linked points and not for an unrelated point', async () => {
    const onA = await app.inject({
      method: 'GET',
      url: `/api/capabilities?objectId=${objectA}`,
      headers: { cookie },
    });
    expect(onA.statusCode).toBe(200);
    const listA = onA.json() as { capabilities: unknown[] };
    expect(listA.capabilities.map((item) => capabilitySchema.parse(item).id)).toContain(capabilityId);

    const onB = await app.inject({
      method: 'GET',
      url: `/api/capabilities?objectId=${objectB}`,
      headers: { cookie },
    });
    expect(onB.statusCode).toBe(200);
    const listB = onB.json() as { capabilities: unknown[] };
    expect(listB.capabilities.map((item) => capabilitySchema.parse(item).id)).toContain(capabilityId);

    const onC = await app.inject({
      method: 'GET',
      url: `/api/capabilities?objectId=${objectC}`,
      headers: { cookie },
    });
    expect(onC.statusCode).toBe(200);
    expect(onC.json()).toEqual({ capabilities: [] });
  });

  it('does not write evidence when creating or listing', async () => {
    const rows = await db.select({ id: evidence.id }).from(evidence).where(eq(evidence.capabilityId, capabilityId));
    expect(rows).toEqual([]);
  });

  it('does not insert a capability when the primary point is missing', async () => {
    const statement = `不会写入-${suffix}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/capabilities',
      headers: { cookie },
      payload: {
        statement,
        kind: 'explain',
        primaryObjectId: randomUUID(),
      },
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json())).toEqual({ code: 'not_found', message: '没有这个点' });
    const leaked = await db.select({ id: capabilities.id }).from(capabilities).where(eq(capabilities.statement, statement));
    expect(leaked).toEqual([]);
  });
});
