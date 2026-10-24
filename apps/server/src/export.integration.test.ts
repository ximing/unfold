import {
  collectionSchema,
  domainSchema,
  exportPackageSchema,
  objectSummarySchema,
  relationSchema,
} from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { collections, documents, domains, knowledgeObjects, relations, users } from './db/schema.js';

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

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(',');
  return value ?? '';
}

function objectRefIds(content: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const record = node as { type?: unknown; attrs?: { objectId?: unknown }; content?: unknown };
    if (record.type === 'object_ref' && typeof record.attrs?.objectId === 'string') {
      ids.push(record.attrs.objectId);
    }
    walk(record.content);
  };
  walk(content);
  return ids;
}

describe('export package', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const suffix = Date.now();
  const domainName = `导出领域-${suffix}`;
  const objectAName = `点A-${suffix}`;
  const objectBName = `点B-${suffix}`;
  const collectionTitle = `导出合集-${suffix}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  const collectionIds: string[] = [];
  const relationIds: string[] = [];
  let domainId = '';
  let objectAId = '';
  let objectBId = '';
  let relationId = '';
  let collectionId = '';

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
    if (!found[0]) throw new Error('seed user missing');
  });

  afterAll(async () => {
    const now = new Date();
    if (relationIds.length > 0) {
      await db
        .update(relations)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(relations.id, relationIds));
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

  it('rejects GET /api/export without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthenticated', message: '未登录' } });
  });

  it('exports domains, objects, documents, relations, and collections', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(createdDomain.statusCode).toBe(201);
    domainId = domainSchema.parse(createdDomain.json()).id;
    domainIds.push(domainId);

    const createdA = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type: 'concept', canonicalName: objectAName, coreStatement: '' },
    });
    expect(createdA.statusCode).toBe(201);
    objectAId = objectSummarySchema.parse(createdA.json()).id;
    objectIds.push(objectAId);

    const createdB = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type: 'concept', canonicalName: objectBName, coreStatement: '' },
    });
    expect(createdB.statusCode).toBe(201);
    objectBId = objectSummarySchema.parse(createdB.json()).id;
    objectIds.push(objectBId);

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectAId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        plainText: '段落甲',
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '段落甲' }] },
            { type: 'object_ref', attrs: { objectId: objectBId, label: objectBName } },
          ],
        },
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const createdRelation = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: objectBId,
        toId: objectAId,
        type: 'implements',
        distinction: '',
        whatChanged: '',
        condition: '',
        boundary: '',
        note: '实现',
      },
    });
    expect(createdRelation.statusCode, createdRelation.body).toBe(201);
    relationId = relationSchema.parse(createdRelation.json()).id;
    relationIds.push(relationId);

    const createdCollection = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId, title: collectionTitle },
    });
    expect(createdCollection.statusCode, createdCollection.body).toBe(201);
    collectionId = collectionSchema.parse(createdCollection.json()).id;
    collectionIds.push(collectionId);

    const res = await app.inject({
      method: 'GET',
      url: '/api/export',
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(headerValue(res.headers['content-disposition'])).toContain('unfold-export.json');
    const pack = exportPackageSchema.parse(res.json());
    expect(pack.objects.map((item) => item.id)).toEqual(expect.arrayContaining([objectAId, objectBId]));
    expect(pack.relations.map((item) => item.id)).toContain(relationId);
    expect(pack.collections.map((item) => item.id)).toContain(collectionId);
    const doc = pack.documents.find((item) => item.ownerType === 'object' && item.ownerId === objectAId);
    if (!doc) throw new Error('missing document');
    expect(doc.markdown).toContain('段落甲');
    expect(doc.markdown).toContain(`[[object:${objectBId}|${objectBName}]]`);
    expect(objectRefIds(doc.content)).toContain(objectBId);
  });

  it('omits a soft-deleted object', async () => {
    const now = new Date();
    await db
      .update(knowledgeObjects)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(knowledgeObjects.id, objectAId));

    const res = await app.inject({
      method: 'GET',
      url: '/api/export',
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const pack = exportPackageSchema.parse(res.json());
    expect(JSON.stringify(pack.objects)).not.toContain(objectAId);
  });
});
