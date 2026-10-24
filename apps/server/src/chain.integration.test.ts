import { domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { chainResponseSchema } from './chain.js';
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

describe('chain', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const stamp = Date.now();
  const domainName = `领域-${stamp}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let domainId = '';
  let originId = '';
  let focusId = '';
  let laterId = '';

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

  async function createObject(canonicalName: string, coreStatement: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type: 'concept', canonicalName, coreStatement },
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
    originId = await createObject('决策树', '展开前的决策');
    focusId = await createObject('状态等价', '合并后的状态');
    laterId = await createObject('Memo', '第一次算完就留下');

    const first = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: focusId,
        toId: originId,
        type: 'evolves_from',
        whatChanged: '重复子问题被合并',
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: laterId,
        toId: focusId,
        type: 'evolves_from',
        whatChanged: '第一次算完就记住',
      },
    });
    expect(second.statusCode).toBe(201);
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

  it('rejects GET /api/objects/:id/chain without a cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${focusId}/chain`,
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json()).code).toBe('unauthenticated');
  });

  it('returns 404 when the point does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/objects/00000000-0000-4000-8000-000000000000/chain',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json())).toEqual({ code: 'not_found', message: '没有这个点' });
  });

  it('orders the accepted evolves_from chain from the origin on the left', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${focusId}/chain`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = chainResponseSchema.parse(res.json());
    const chain = body.chains.find((item) => item.type === 'evolves_from');
    expect(chain).toBeDefined();
    expect(body.chains.filter((item) => item.type === 'evolves_from')).toHaveLength(1);
    expect(chain?.nodes.map((node) => node.id)).toEqual([originId, focusId, laterId]);
    expect(chain?.nodes.map((node) => node.canonicalName)).toEqual(['决策树', '状态等价', 'Memo']);
    expect(chain?.nodes.map((node) => node.coreStatement)).toEqual([
      '展开前的决策',
      '合并后的状态',
      '第一次算完就留下',
    ]);
    expect(chain?.nodes.map((node) => ({ x: node.x, y: node.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 320, y: 0 },
    ]);
    expect(chain?.edges).toEqual([
      { fromId: originId, toId: focusId, whatChanged: '重复子问题被合并' },
      { fromId: focusId, toId: laterId, whatChanged: '第一次算完就记住' },
    ]);
  });

  it('leaves a suggested evolves_from off the chain', async () => {
    const extraId = await createObject('还没接受', '不该出现在链上');
    await db.insert(relations).values({
      userId,
      fromId: extraId,
      toId: laterId,
      type: 'evolves_from',
      whatChanged: '这条建议不该上链',
      status: 'suggested',
      origin: 'rule',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${focusId}/chain`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = chainResponseSchema.parse(res.json());
    const chain = body.chains.find((item) => item.type === 'evolves_from');
    expect(chain?.edges.map((edge) => edge.whatChanged)).toEqual(['重复子问题被合并', '第一次算完就记住']);
    expect(chain?.nodes.some((node) => node.id === extraId)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('这条建议不该上链');
  });
});
