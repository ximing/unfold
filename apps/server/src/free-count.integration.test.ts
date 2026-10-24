import {
  collectionSchema,
  domainListSchema,
  domainSchema,
  objectSummarySchema,
  todayResponseSchema,
} from '@unfold/dto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { collections, documents, domains, knowledgeObjects, revisions, users } from './db/schema.js';

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

describe('free count', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  let todayBefore = 0;
  const suffix = Date.now();
  const domainName = `领域-${suffix}`;
  const title = `合集-${suffix}`;
  const firstName = `点-a-${suffix}`;
  const secondName = `点-b-${suffix}`;
  const domainIds: string[] = [];
  const collectionIds: string[] = [];
  const objectIds: string[] = [];
  let domainId = '';
  let collectionId = '';
  let firstId = '';

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
    if (userId && collectionId) {
      await db
        .update(revisions)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(revisions.userId, userId),
            isNull(revisions.deletedAt),
            sql`${revisions.payload}->>'collectionId' = ${collectionId}`,
          ),
        );
    }
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

  async function todayFreeCount(): Promise<number> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/today',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return todayResponseSchema.parse(res.json()).freeCount;
  }

  async function domainFreeCount(): Promise<number> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/domains',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const listed = domainListSchema.parse(res.json());
    const domain = listed.domains.find((item) => item.id === domainId);
    if (!domain) throw new Error('missing domain');
    return domain.freeCount;
  }

  async function createPoint(canonicalName: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId,
        type: 'concept',
        canonicalName,
        coreStatement: '',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = objectSummarySchema.parse(res.json());
    objectIds.push(created.id);
    return created.id;
  }

  it('counts two active points that are not filed in a collection', async () => {
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

    todayBefore = await todayFreeCount();
    firstId = await createPoint(firstName);
    await createPoint(secondName);

    expect(await domainFreeCount()).toBe(2);
    expect(await todayFreeCount()).toBe(todayBefore + 2);
  });

  it('stops counting a point after a collection files it', async () => {
    const createdCollection = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId, title },
    });
    expect(createdCollection.statusCode).toBe(201);
    const collection = collectionSchema.parse(createdCollection.json());
    collectionId = collection.id;
    collectionIds.push(collection.id);

    const added = await app.inject({
      method: 'POST',
      url: `/api/collections/${collectionId}/refs`,
      headers: { cookie },
      payload: { op: 'add', objectId: firstId },
    });
    expect(added.statusCode).toBe(200);
    expect(await domainFreeCount()).toBe(1);
    expect(await todayFreeCount()).toBe(todayBefore + 1);
  });

  it('counts the point again after it is removed from the collection', async () => {
    const removed = await app.inject({
      method: 'POST',
      url: `/api/collections/${collectionId}/refs`,
      headers: { cookie },
      payload: { op: 'remove', objectId: firstId },
    });
    expect(removed.statusCode).toBe(200);
    expect(await domainFreeCount()).toBe(2);
    expect(await todayFreeCount()).toBe(todayBefore + 2);
  });
});
