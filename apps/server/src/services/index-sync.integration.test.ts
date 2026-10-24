import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, createPool } from '../db/client.js';
import { blockIndex, documents, domains, indexOutbox, knowledgeObjects, users } from '../db/schema.js';
import { entryPointId, syncObjectIndex } from './index-sync.js';

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

type Hit = { id?: string; object_id?: string | null };

async function pollHits(q: string, userId: string, accept: (hits: Hit[]) => boolean): Promise<void> {
  const base = process.env.MEILI_URL;
  const key = process.env.MEILI_SEARCH_KEY;
  if (!base) throw new Error('MEILI_URL is not set');
  if (!key) throw new Error('MEILI_SEARCH_KEY is not set');
  let useFilter = true;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const body: { q: string; filter?: string } = { q };
    if (useFilter) body.filter = `user_id = "${userId}"`;
    const res = await fetch(`${base.replace(/\/$/, '')}/indexes/unfold/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 400 && useFilter) {
      useFilter = false;
      continue;
    }
    if (res.status === 200) {
      const payload = (await res.json()) as { hits?: Hit[] };
      const hits = payload.hits ?? [];
      if (accept(hits)) return;
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('search miss');
}

describe('index sync', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool> | undefined;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  let domainId = '';
  const stamp = Date.now();
  const domainIds: string[] = [];
  const objectIds: string[] = [];

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

  async function createObject(canonicalName: string, coreStatement: string): Promise<string> {
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
    domainId = await createDomain(`领域-${stamp}`);
  });

  afterAll(async () => {
    try {
      if (db && objectIds.length > 0) {
        const docs = await db
          .select({ id: documents.id })
          .from(documents)
          .where(inArray(documents.ownerId, objectIds));
        const documentIds = docs.map((row) => row.id);
        const blocks =
          documentIds.length > 0
            ? await db
                .select({ blockId: blockIndex.blockId })
                .from(blockIndex)
                .where(inArray(blockIndex.documentId, documentIds))
            : [];
        const entryIds = [
          ...objectIds.map((id) => `object:${id}`),
          ...blocks.flatMap((block) => [
            `block:${block.blockId}`,
            `question:${block.blockId}`,
            `decision:${block.blockId}`,
            `collection_sentence:${block.blockId}`,
          ]),
        ];
        try {
          const base = process.env.MEILI_URL;
          const admin = process.env.MEILI_ADMIN_KEY;
          if (base && admin && entryIds.length > 0) {
            const res = await fetch(`${base.replace(/\/$/, '')}/indexes/unfold/documents/delete-batch`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
              body: JSON.stringify([...entryIds, ...entryIds.map((id) => id.replaceAll(':', '_'))]),
              signal: AbortSignal.timeout(8000),
            });
            if (res.status !== 200 && res.status !== 202 && res.status !== 404) {
              await res.text().catch(() => undefined);
            }
          }
        } catch {
          // 清理失败不让测试失败
        }
        try {
          const base = process.env.QDRANT_URL;
          const key = process.env.QDRANT_API_KEY;
          if (base && entryIds.length > 0) {
            const headers = new Headers({ 'Content-Type': 'application/json' });
            if (key) headers.set('api-key', key);
            const res = await fetch(
              `${base.replace(/\/$/, '')}/collections/unfold_chunks/points/delete?wait=true`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({ points: entryIds.map((id) => entryPointId(id)) }),
                signal: AbortSignal.timeout(8000),
              },
            );
            if (res.status === 404) {
              // 集合不存在就当清理完成
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
    } finally {
      process.env.UNFOLD_INDEX = 'off';
      if (pool) await pool.end();
      if (app) await app.close();
    }
  });

  it('indexes the object core and the question block', async () => {
    process.env.UNFOLD_INDEX = 'on';
    const objectId = await createObject(`点${stamp}`, `索引词${stamp}`);
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: SCHEMA_VERSION,
        plainText: `疑问词${stamp}`,
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: `块词${stamp}` }] },
            {
              type: 'question',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `疑问词${stamp}` }] }],
            },
          ],
        },
      },
    });
    expect(saved.statusCode).toBe(200);

    await pollHits(`索引词${stamp}`, userId, (hits) => hits.some((hit) => hit.id === `object:${objectId}`));
    await pollHits(`疑问词${stamp}`, userId, (hits) =>
      hits.some((hit) => typeof hit.id === 'string' && hit.id.startsWith('question:')),
    );

    const stored = await db
      .select({ plainText: documents.plainText })
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          eq(documents.ownerType, 'object'),
          eq(documents.ownerId, objectId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    expect(stored[0]?.plainText ?? '').toContain(`疑问词${stamp}`);
  });

  it('writes an upsert outbox row when meili add fails', async () => {
    process.env.UNFOLD_INDEX = 'on';
    const id = await createObject(`失败点${stamp}`, `失败点${stamp}`);
    await expect(
      syncObjectIndex(db, userId, id, {
        meiliAdd: async () => {
          throw new Error('meili down');
        },
      }),
    ).resolves.toBeUndefined();

    const docs = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.ownerType, 'object'), eq(documents.ownerId, id)))
      .limit(1);
    const documentId = docs[0]?.id;
    expect(documentId).toBeTruthy();
    if (!documentId) return;

    const rows = await db
      .select({ lastError: indexOutbox.lastError, deletedAt: indexOutbox.deletedAt })
      .from(indexOutbox)
      .where(and(eq(indexOutbox.documentId, documentId), isNull(indexOutbox.deletedAt)));
    expect(rows.some((row) => row.deletedAt == null && row.lastError.includes('meili down'))).toBe(true);
  });
});
