import { domainSchema, fanRelationListSchema, objectSummarySchema, relationSchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { documents, domains, knowledgeObjects, relations, users } from './db/schema.js';

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

describe('relations', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const stamp = Date.now();
  const domainName = `领域-${stamp}`;
  const otherDomainName = `领域-外-${stamp}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let domainId = '';
  let otherDomainId = '';
  let fromObjectId = '';
  let toObjectId = '';
  let stateObjectId = '';
  let loopObjectId = '';
  let evolvesId = '';
  let suggestedId = '';

  async function createDomain(name: string): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name },
    });
    expect(created.statusCode).toBe(201);
    const id = domainSchema.parse(created.json()).id;
    domainIds.push(id);
    return id;
  }

  async function createObject(ownerDomainId: string, canonicalName: string, coreStatement: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId: ownerDomainId, type: 'concept', canonicalName, coreStatement },
    });
    expect(created.statusCode).toBe(201);
    const id = objectSummarySchema.parse(created.json()).id;
    objectIds.push(id);
    return id;
  }

  beforeAll(async () => {
    app = await buildApp();
    pool = createPool();
    db = createDb(pool);
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);

    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);
    const user = found[0];
    if (!user) throw new Error('seed user missing');
    userId = user.id;

    domainId = await createDomain(domainName);
    otherDomainId = await createDomain(otherDomainName);
    fromObjectId = await createObject(domainId, '子问题', '展开前的核心');
    toObjectId = await createObject(domainId, '合并体', '合并后的核心');
    stateObjectId = await createObject(domainId, '状态', '');
    loopObjectId = await createObject(otherDomainId, '循环', '');
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
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  it('rejects POST /api/relations without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/relations',
      payload: { fromId: fromObjectId, toId: toObjectId, type: 'evolves_from' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json()).code).toBe('unauthenticated');
  });

  it('rejects evolves_from without whatChanged', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: { fromId: fromObjectId, toId: toObjectId, type: 'evolves_from' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({
      code: 'invalid_relation',
      message: '演化要写清变化了什么',
    });
  });

  it('accepts a same-domain evolves_from from the user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: fromObjectId,
        toId: toObjectId,
        type: 'evolves_from',
        whatChanged: '重复子问题被合并',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = relationSchema.parse(res.json());
    evolvesId = body.id;
    expect(body.status).toBe('accepted');
    expect(body.origin).toBe('user');
    expect(body.needsCrossDomainConfirm).toBe(false);
    expect(body.whatChanged).toBe('重复子问题被合并');
  });

  it('lists the edge in the origin sector of the from point', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${fromObjectId}/relations`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = fanRelationListSchema.parse(res.json());
    const edge = body.relations.find((item) => item.id === evolvesId);
    expect(edge).toMatchObject({
      sector: 'origin',
      otherId: toObjectId,
      otherName: '合并体',
      otherCore: '合并后的核心',
      whatChanged: '重复子问题被合并',
    });
  });

  it('lists the same edge in the destination sector of the to point', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${toObjectId}/relations`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = fanRelationListSchema.parse(res.json());
    const edge = body.relations.find((item) => item.id === evolvesId);
    expect(edge).toMatchObject({
      sector: 'destination',
      otherId: fromObjectId,
      otherName: '子问题',
      otherCore: '展开前的核心',
    });
  });

  it('accepts a cross-domain contrast and asks for confirmation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: stateObjectId,
        toId: loopObjectId,
        type: 'contrasts',
        distinction: '一个管状态一个管循环',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = relationSchema.parse(res.json());
    expect(body.status).toBe('accepted');
    expect(body.origin).toBe('user');
    expect(body.needsCrossDomainConfirm).toBe(true);
    expect(body.distinction).toBe('一个管状态一个管循环');
  });

  it('rejects the reverse contrast of the same pair', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: loopObjectId,
        toId: stateObjectId,
        type: 'contrasts',
        distinction: '一个管状态一个管循环',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res.json())).toEqual({
      code: 'duplicate_relation',
      message: '这两个点之间已经有这条对照',
    });
  });

  it('rejects a relation from a point to itself', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: fromObjectId,
        toId: fromObjectId,
        type: 'contrasts',
        distinction: '一个管状态一个管循环',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_relation', message: '不能连接自己' });
  });

  it('hides a suggested relation from the fan', async () => {
    const inserted = await db
      .insert(relations)
      .values({
        userId,
        fromId: fromObjectId,
        toId: toObjectId,
        type: 'prerequisite',
        status: 'suggested',
        origin: 'rule',
      })
      .returning({ id: relations.id });
    const row = inserted[0];
    if (!row) throw new Error('insert suggested relation failed');
    suggestedId = row.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${fromObjectId}/relations`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = fanRelationListSchema.parse(res.json());
    expect(body.relations.some((item) => item.id === suggestedId)).toBe(false);
  });

  it('accepts a suggested relation once and then refuses another change', async () => {
    const accepted = await app.inject({
      method: 'PATCH',
      url: `/api/relations/${suggestedId}`,
      headers: { cookie },
      payload: { status: 'accepted' },
    });
    expect(accepted.statusCode).toBe(200);
    const body = relationSchema.parse(accepted.json());
    expect(body.status).toBe('accepted');
    expect(body.origin).toBe('rule');
    expect(body.needsCrossDomainConfirm).toBe(false);

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/relations/${suggestedId}`,
      headers: { cookie },
      payload: { status: 'rejected' },
    });
    expect(rejected.statusCode).toBe(409);
    expect(errorOf(rejected.json())).toEqual({
      code: 'invalid_transition',
      message: '这条连接不能再改状态',
    });

    const stored = await db
      .select({ status: relations.status })
      .from(relations)
      .where(eq(relations.id, suggestedId))
      .limit(1);
    expect(stored[0]?.status).toBe('accepted');
  });

  it('refuses to delete a point that still has an accepted relation', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${toObjectId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
    const payload: unknown = res.json();
    const error = errorOf(payload);
    expect(error.code).toBe('referenced');
    expect(error.message.startsWith('还有 ')).toBe(true);
    if (!payload || typeof payload !== 'object' || !('error' in payload)) {
      throw new Error('missing error');
    }
    const body = payload.error;
    if (!body || typeof body !== 'object' || !('count' in body) || typeof body.count !== 'number') {
      throw new Error('missing count');
    }
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(error.message).toBe(`还有 ${body.count} 处引用这个点`);
  });

  it('deletes a point whose only relation is still suggested', async () => {
    const loneFromId = await createObject(domainId, '孤立甲', '');
    const loneToId = await createObject(domainId, '孤立乙', '');
    await db.insert(relations).values({
      userId,
      fromId: loneFromId,
      toId: loneToId,
      type: 'prerequisite',
      status: 'suggested',
      origin: 'rule',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${loneFromId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });
});
