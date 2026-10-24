import {
  collectionDetailSchema,
  collectionReadSchema,
  collectionSchema,
  documentResponseSchema,
  domainSchema,
  objectSummarySchema,
} from '@unfold/dto';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import {
  collectionReads,
  collections,
  documents,
  domains,
  evidence,
  knowledgeObjects,
  revisions,
  users,
} from './db/schema.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const pendingMessage = '核心定义已更新，待确认' as const;

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('missing set-cookie');
  const pair = header.split(';')[0];
  if (!pair) throw new Error('missing set-cookie');
  return pair;
}

describe('collection reads', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const stamp = Date.now();
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  const collectionIds: string[] = [];

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
  });

  afterAll(async () => {
    const now = new Date();
    if (userId && collectionIds.length > 0) {
      await db
        .update(revisions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(revisions.userId, userId),
            isNull(revisions.deletedAt),
            sql`${revisions.payload}->>'collectionId' in (${sql.join(
              collectionIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        );
      await db
        .update(collectionReads)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(collectionReads.collectionId, collectionIds));
    }
    if (collectionIds.length > 0) {
      await db.update(collections).set({ deletedAt: now, updatedAt: now }).where(inArray(collections.id, collectionIds));
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(documents.ownerType, 'collection'), inArray(documents.ownerId, collectionIds)));
    }
    if (objectIds.length > 0) {
      await db
        .update(knowledgeObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(knowledgeObjects.id, objectIds));
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(documents.ownerType, 'object'), inArray(documents.ownerId, objectIds)));
    }
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  async function evidenceRows(): Promise<number> {
    const rows = await db.select({ n: count() }).from(evidence);
    return Number(rows[0]?.n ?? 0);
  }

  async function detail(collectionId: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/collections/${collectionId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return collectionDetailSchema.parse(res.json());
  }

  it('待确认只比较核心陈述，确认不改点和文档', async () => {
    const domain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: `领域-${stamp}` },
    });
    expect(domain.statusCode).toBe(201);
    const domainId = domainSchema.parse(domain.json()).id;
    domainIds.push(domainId);

    const createdObject = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId,
        type: 'concept',
        canonicalName: `点-${stamp}`,
        coreStatement: '旧定义',
      },
    });
    expect(createdObject.statusCode).toBe(201);
    const objectId = objectSummarySchema.parse(createdObject.json()).id;
    objectIds.push(objectId);

    const titles = [`合集A-${stamp}`, `合集B-${stamp}`];
    for (const title of titles) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { cookie },
        payload: { domainId, title, intent: '' },
      });
      expect(created.statusCode).toBe(201);
      collectionIds.push(collectionSchema.parse(created.json()).id);
    }
    const collectionA = collectionIds[0];
    const collectionB = collectionIds[1];
    if (!collectionA || !collectionB) throw new Error('missing collections');

    for (const collectionId of [collectionA, collectionB]) {
      const added = await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/refs`,
        headers: { cookie },
        payload: { op: 'add', objectId },
      });
      expect(added.statusCode).toBe(200);
    }

    expect((await detail(collectionA)).pending).toEqual([]);
    expect((await detail(collectionB)).pending).toEqual([]);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/objects/${objectId}`,
      headers: { cookie },
      payload: { canonicalName: `点改名-${stamp}` },
    });
    expect(renamed.statusCode).toBe(200);
    expect((await detail(collectionA)).pending).toEqual([]);
    expect((await detail(collectionB)).pending).toEqual([]);

    const evidenceBefore = await evidenceRows();

    const restated = await app.inject({
      method: 'PATCH',
      url: `/api/objects/${objectId}`,
      headers: { cookie },
      payload: { coreStatement: '新定义' },
    });
    expect(restated.statusCode).toBe(200);

    const pending = [{ objectId, message: pendingMessage }];
    expect((await detail(collectionA)).pending).toEqual(pending);
    expect((await detail(collectionB)).pending).toEqual(pending);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/collections/${collectionA}/reads`,
      headers: { cookie },
      payload: { objectId },
    });
    expect(confirmed.statusCode).toBe(200);
    const read = collectionReadSchema.parse(confirmed.json());
    expect(read.objectId).toBe(objectId);
    expect(read.seenStatement).toBe('新定义');

    expect((await detail(collectionA)).pending).toEqual([]);
    expect((await detail(collectionB)).pending).toEqual(pending);

    const object = await app.inject({
      method: 'GET',
      url: `/api/objects/${objectId}`,
      headers: { cookie },
    });
    expect(object.statusCode).toBe(200);
    expect(objectSummarySchema.parse(object.json()).coreStatement).toBe('新定义');

    const doc = await app.inject({
      method: 'GET',
      url: `/api/collections/${collectionA}/doc`,
      headers: { cookie },
    });
    expect(doc.statusCode).toBe(200);
    const content = documentResponseSchema.parse(doc.json()).content;
    expect(JSON.stringify(content)).toContain(objectId);
    expect(await evidenceRows()).toBe(evidenceBefore);
  });
});
