import { documentResponseSchema, domainSchema, exportPackageSchema, objectSummarySchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { documents, domains, knowledgeObjects, users } from './db/schema.js';

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

describe('import package', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const suffix = Date.now();
  const domainName = `导入领域-${suffix}`;
  const objectAName = `点A-${suffix}`;
  const objectBName = `点B-${suffix}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let domainId = '';
  let objectAId = '';
  let objectBId = '';
  let documentId = '';

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

  it('rejects POST /api/import without a cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/import', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'unauthenticated', message: '未登录' } });
  });

  it('rejects an empty body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'invalid_body', message: '请求格式不正确' } });
  });

  it('restores a deleted object and keeps ids', async () => {
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

    const exportedRes = await app.inject({
      method: 'GET',
      url: '/api/export',
      headers: { cookie },
    });
    expect(exportedRes.statusCode, exportedRes.body).toBe(200);
    const exported = exportedRes.json();
    const pack = exportPackageSchema.parse(exported);
    const objectA = pack.objects.find((item) => item.id === objectAId);
    if (!objectA?.documentId) throw new Error('missing object A document');
    documentId = objectA.documentId;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${objectAId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode, deleted.body).toBe(204);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: exported,
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toEqual({ ok: true });

    const restored = await app.inject({
      method: 'GET',
      url: `/api/objects/${objectAId}`,
      headers: { cookie },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const summary = objectSummarySchema.parse(restored.json());
    expect(summary.id).toBe(objectAId);
    expect(summary.canonicalName).toBe(objectAName);

    const docRes = await app.inject({
      method: 'GET',
      url: `/api/objects/${objectAId}/doc`,
      headers: { cookie },
    });
    expect(docRes.statusCode, docRes.body).toBe(200);
    const docBody = documentResponseSchema.parse(docRes.json());
    const linked = await db
      .select({ documentId: knowledgeObjects.documentId })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, objectAId))
      .limit(1);
    expect(linked[0]?.documentId).toBe(documentId);
    expect(docBody.plainText.includes('段落甲') || JSON.stringify(docBody.content).includes('段落甲')).toBe(true);
    expect(objectRefIds(docBody.content)).toContain(objectBId);

    const again = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie },
      payload: exported,
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual({ ok: true });

    const still = await app.inject({
      method: 'GET',
      url: `/api/objects/${objectAId}`,
      headers: { cookie },
    });
    expect(still.statusCode, still.body).toBe(200);
    expect(objectSummarySchema.parse(still.json()).id).toBe(objectAId);
  });
});
