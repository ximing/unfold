import { domainSchema, fanRelationListSchema, objectSummarySchema, relationSchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { documents, domains, knowledgeObjects, relations, users } from './db/schema.js';
import { contrastMatrix } from './services/contrast-matrix.js';

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

describe('contrast matrix', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const stamp = Date.now();
  const domainName = `领域-${stamp}`;
  const leftName = `左点-${stamp}`;
  const rightName = `右点-${stamp}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  const relationIds: string[] = [];
  let domainId = '';
  let leftId = '';
  let rightId = '';

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

  async function contrastsEdge() {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${leftId}/relations`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = fanRelationListSchema.parse(res.json());
    const edge = body.relations.find((item) => item.type === 'contrasts');
    if (!edge) throw new Error('missing contrasts relation');
    return edge;
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
    leftId = await createObject(leftName, '左陈述');
    rightId = await createObject(rightName, '右陈述');
  });

  afterAll(async () => {
    const now = new Date();
    if (relationIds.length > 0) {
      await db
        .update(relations)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(relations.id, relationIds));
    }
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

  it('reads distinction and otherCore into the contrast matrix, then sees a drizzle update', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: leftId,
        toId: rightId,
        type: 'contrasts',
        distinction: '旧区别',
      },
    });
    expect(created.statusCode).toBe(201);
    relationIds.push(relationSchema.parse(created.json()).id);

    const edge = await contrastsEdge();
    expect(edge.distinction).toBe('旧区别');
    expect(edge.otherName).toBe(rightName);
    expect(edge.otherCore).toBe('右陈述');
    const matrix = contrastMatrix(
      { canonicalName: leftName, coreStatement: '左陈述' },
      { canonicalName: edge.otherName, coreStatement: edge.otherCore },
      { type: edge.type, distinction: edge.distinction },
    );
    expect(matrix[1]).toEqual({ label: '区别', left: '旧区别', right: '旧区别' });
    expect(matrix[0]?.left).toBe('左陈述');
    expect(matrix[0]?.right).toBe('右陈述');

    const updated = await db
      .update(relations)
      .set({ distinction: '新区别', updatedAt: new Date() })
      .where(and(eq(relations.id, edge.id), eq(relations.userId, userId), isNull(relations.deletedAt)))
      .returning({ id: relations.id });
    expect(updated).toHaveLength(1);

    const nextEdge = await contrastsEdge();
    const next = contrastMatrix(
      { canonicalName: leftName, coreStatement: '左陈述' },
      { canonicalName: nextEdge.otherName, coreStatement: nextEdge.otherCore },
      { type: nextEdge.type, distinction: nextEdge.distinction },
    );
    expect(next[1]).toEqual({ label: '区别', left: '新区别', right: '新区别' });
    expect(next[0]).toEqual(matrix[0]);

    // contrasts 与 analogous 共用无向唯一索引，撞上就换另一对点。
    let analogFromId = leftId;
    let analogLeftName = leftName;
    let analogLeftCore = '左陈述';
    const samePair = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: leftId,
        toId: rightId,
        type: 'analogous',
        boundary: '只在结构上像',
      },
    });
    if (samePair.statusCode === 201) {
      relationIds.push(relationSchema.parse(samePair.json()).id);
    } else {
      expect(samePair.statusCode).toBe(409);
      analogLeftName = `类比左-${stamp}`;
      analogLeftCore = '类比左陈述';
      analogFromId = await createObject(analogLeftName, analogLeftCore);
      const analogRightId = await createObject(`类比右-${stamp}`, '类比右陈述');
      const analogous = await app.inject({
        method: 'POST',
        url: '/api/relations',
        headers: { cookie },
        payload: {
          fromId: analogFromId,
          toId: analogRightId,
          type: 'analogous',
          boundary: '只在结构上像',
        },
      });
      expect(analogous.statusCode).toBe(201);
      relationIds.push(relationSchema.parse(analogous.json()).id);
    }

    const listed = await app.inject({
      method: 'GET',
      url: `/api/objects/${analogFromId}/relations`,
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    const analog = fanRelationListSchema.parse(listed.json()).relations.find((item) => item.type === 'analogous');
    if (!analog) throw new Error('missing analogous relation');
    expect(
      contrastMatrix(
        { canonicalName: analogLeftName, coreStatement: analogLeftCore },
        { canonicalName: analog.otherName, coreStatement: analog.otherCore },
        { type: analog.type, distinction: analog.distinction },
      ),
    ).toEqual([]);
  });
});
