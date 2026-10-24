import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { domainSchema, objectSummarySchema, searchResponseSchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { documents, domains, indexOutbox, knowledgeObjects, users } from './db/schema.js';
import { searchLibrary } from './services/search-query.js';

process.env.UNFOLD_INDEX = 'on';

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

describe('search', () => {
  let app: FastifyInstance | undefined;
  let pool: ReturnType<typeof createPool> | undefined;
  let db: ReturnType<typeof createDb> | undefined;
  let cookie = '';
  let userId = '';
  const stamp = Date.now();
  const domainIds: string[] = [];
  const objectIds: string[] = [];

  async function createDomain(name: string): Promise<string> {
    const created = await app!.inject({
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

  async function createObject(domainId: string, canonicalName: string, coreStatement: string): Promise<string> {
    const created = await app!.inject({
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
    process.env.UNFOLD_INDEX = 'on';
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
    try {
      if (db && objectIds.length > 0) {
        const docs = await db
          .select({ id: documents.id })
          .from(documents)
          .where(inArray(documents.ownerId, objectIds));
        const documentIds = docs.map((row) => row.id);
        try {
          const base = process.env.MEILI_URL?.replace(/\/$/, '');
          const admin = process.env.MEILI_ADMIN_KEY;
          if (base && admin) {
            for (const id of objectIds) {
              const res = await fetch(`${base}/indexes/unfold/documents/delete`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ filter: `object_id = "${id}"` }),
                signal: AbortSignal.timeout(8000),
              });
              if (res.status !== 200 && res.status !== 202 && res.status !== 404) {
                await res.text().catch(() => undefined);
              }
            }
          }
        } catch {
          // 清理失败不让测试失败
        }
        try {
          const base = process.env.QDRANT_URL?.replace(/\/$/, '');
          const key = process.env.QDRANT_API_KEY;
          if (base) {
            const headers = new Headers({ 'Content-Type': 'application/json' });
            if (key) headers.set('api-key', key);
            await fetch(`${base}/collections/unfold_chunks/index?wait=true`, {
              method: 'PUT',
              headers,
              body: JSON.stringify({ field_name: 'object_id', field_schema: 'keyword' }),
              signal: AbortSignal.timeout(8000),
            }).catch(() => undefined);
            for (const id of objectIds) {
              const res = await fetch(`${base}/collections/unfold_chunks/points/delete?wait=true`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ filter: { must: [{ key: 'object_id', match: { value: id } }] } }),
                signal: AbortSignal.timeout(8000),
              });
              if (res.status === 404) break;
            }
          }
        } catch {
          // 清理失败不让测试失败
        }
        const now = new Date();
        if (documentIds.length > 0) {
          await db
            .update(indexOutbox)
            .set({ deletedAt: now, updatedAt: now })
            .where(inArray(indexOutbox.documentId, documentIds));
          await db
            .update(documents)
            .set({ deletedAt: now, updatedAt: now })
            .where(inArray(documents.id, documentIds));
        }
        await db
          .update(knowledgeObjects)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(knowledgeObjects.id, objectIds));
        await db
          .update(documents)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(documents.ownerId, objectIds));
      }
      if (db && domainIds.length > 0) {
        const now = new Date();
        await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
      }
    } catch {
      // 清理失败不让测试失败
    } finally {
      process.env.UNFOLD_INDEX = 'off';
      if (pool) await pool.end().catch(() => undefined);
      if (app) await app.close();
    }
  });

  it('splits same-name points by domain and finds a question', async () => {
    const domainA = await createDomain(`算法${stamp}`);
    const domainB = await createDomain(`Agent${stamp}`);
    const name = `状态${stamp}`;
    const leftId = await createObject(domainA, name, `核心甲${stamp}`);
    const rightId = await createObject(domainB, name, `核心乙${stamp}`);
    const saved = await app!.inject({
      method: 'PUT',
      url: `/api/objects/${leftId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: SCHEMA_VERSION,
        plainText: `疑问词${stamp}`,
        content: {
          type: 'doc',
          content: [
            {
              type: 'question',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `疑问词${stamp}` }] }],
            },
          ],
        },
      },
    });
    expect(saved.statusCode).toBe(200);

    const byName = await app!.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(name)}`,
      headers: { cookie },
    });
    expect(byName.statusCode).toBe(200);
    const named = searchResponseSchema.parse(byName.json());
    expect(named.notice === '' || named.notice === '检索降级中').toBe(true);
    const matched = named.groups.filter((group) => group.title === name);
    expect(matched).toHaveLength(2);
    expect(new Set(matched.map((group) => group.domain))).toEqual(new Set([`算法${stamp}`, `Agent${stamp}`]));
    expect(new Set(matched.map((group) => group.objectId))).toEqual(new Set([leftId, rightId]));

    const byQuestion = await app!.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(`疑问词${stamp}`)}`,
      headers: { cookie },
    });
    expect(byQuestion.statusCode).toBe(200);
    const questioned = searchResponseSchema.parse(byQuestion.json());
    expect(questioned.notice === '' || questioned.notice === '检索降级中').toBe(true);
    expect(questioned.groups.some((group) => group.hits.some((hit) => hit.kind === 'question'))).toBe(true);
  });

  it('falls back to ILIKE when meili and qdrant throw', async () => {
    const domainId = await createDomain(`兜底领域${stamp}`);
    const objectId = await createObject(domainId, `兜底点${stamp}`, `这里有兜底词${stamp}`);
    const result = await searchLibrary(db!, userId, `兜底词${stamp}`, {
      meiliSearch: async () => {
        throw new Error('meili down');
      },
      qdrantSearch: async () => {
        throw new Error('qdrant down');
      },
    });
    expect(result.degraded).toBe(true);
    expect(result.notice).toBe('检索降级中');
    expect(result.groups.some((group) => group.objectId === objectId)).toBe(true);

    const stored = await db!
      .select({
        coreStatement: knowledgeObjects.coreStatement,
        deletedAt: knowledgeObjects.deletedAt,
        documentId: knowledgeObjects.documentId,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, objectId))
      .limit(1);
    expect(stored[0]?.deletedAt ?? null).toBeNull();
    expect(stored[0]?.coreStatement).toContain(`兜底词${stamp}`);
    const documentId = stored[0]?.documentId;
    expect(documentId).toBeTruthy();
    const doc = await db!
      .select({ deletedAt: documents.deletedAt })
      .from(documents)
      .where(and(eq(documents.id, documentId ?? objectId), eq(documents.userId, userId)))
      .limit(1);
    expect(doc[0]?.deletedAt ?? null).toBeNull();
  });

  it('rejects anonymous search and an empty query', async () => {
    const anon = await app!.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(`状态${stamp}`)}`,
    });
    expect(anon.statusCode).toBe(401);
    expect(errorOf(anon.json())).toEqual({ code: 'unauthenticated', message: '未登录' });

    const empty = await app!.inject({
      method: 'GET',
      url: '/api/search?q=',
      headers: { cookie },
    });
    expect(empty.statusCode).toBe(400);
    expect(errorOf(empty.json())).toEqual({ code: 'invalid_body', message: '请求格式不正确' });
  });
});
