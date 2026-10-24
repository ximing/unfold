import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { collectionSchema, documentResponseSchema, domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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

function childBlocks(content: unknown): unknown[] {
  if (!content || typeof content !== 'object' || !('content' in content) || !Array.isArray(content.content)) {
    throw new Error('missing content');
  }
  return content.content;
}

function blockType(node: unknown): string {
  if (!node || typeof node !== 'object' || !('type' in node) || typeof node.type !== 'string') {
    throw new Error('missing block');
  }
  return node.type;
}

function blockAttrs(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || !('attrs' in node) || !node.attrs || typeof node.attrs !== 'object') {
    throw new Error('missing attrs');
  }
  return node.attrs as Record<string, unknown>;
}

function textAt(content: unknown, index: number): string {
  const node = childBlocks(content)[index];
  if (!node || typeof node !== 'object' || !('content' in node) || !Array.isArray(node.content)) {
    throw new Error('missing text');
  }
  const text = node.content[0];
  if (!text || typeof text !== 'object' || !('text' in text) || typeof text.text !== 'string') {
    throw new Error('missing text');
  }
  return text.text;
}

function objectRefIds(content: unknown): string[] {
  const ids: string[] = [];
  for (const node of childBlocks(content)) {
    if (blockType(node) !== 'object_ref') continue;
    const objectId = blockAttrs(node).objectId;
    if (typeof objectId !== 'string') throw new Error('missing objectId');
    ids.push(objectId);
  }
  return ids;
}

describe('undo structure commands', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const suffix = Date.now();
  const domainName = `领域-${suffix}`;
  const title = `合集-${suffix}`;
  const objectName = `点-${suffix}`;
  const paragraphText = `段落-${suffix}`;
  const domainIds: string[] = [];
  const collectionIds: string[] = [];
  const objectIds: string[] = [];
  let collectionId = '';
  let objectId = '';

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
      for (const id of collectionIds) {
        await db
          .update(revisions)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(revisions.userId, userId),
              isNull(revisions.deletedAt),
              sql`${revisions.payload}->>'collectionId' = ${id}`,
            ),
          );
      }
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

  async function revisionCount(): Promise<number> {
    const rows = await db
      .select({ count: sql<string>`count(*)::text` })
      .from(revisions)
      .where(eq(revisions.userId, userId));
    return Number(rows[0]?.count ?? 0);
  }

  async function collectionDocument() {
    const res = await app.inject({
      method: 'GET',
      url: `/api/collections/${collectionId}/doc`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return documentResponseSchema.parse(res.json());
  }

  async function postRef(payload: { op: 'add' | 'remove' | 'move'; objectId: string; position?: number }) {
    return app.inject({
      method: 'POST',
      url: `/api/collections/${collectionId}/refs`,
      headers: { cookie },
      payload,
    });
  }

  async function postUndo() {
    return app.inject({
      method: 'POST',
      url: '/api/undo',
      headers: { cookie },
    });
  }

  it('rejects POST /api/undo without a cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/undo' });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json())).toEqual({ code: 'unauthenticated', message: '未登录' });
  });

  it('returns 404 when the user has no open structure command', async () => {
    const res = await postUndo();
    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json())).toEqual({ code: 'not_found', message: '没有可撤销的结构命令' });
  });

  it('undoes collection.add without inserting a revision', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    domainIds.push(domain.id);

    const createdCollection = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { cookie },
      payload: { domainId: domain.id, title },
    });
    expect(createdCollection.statusCode).toBe(201);
    const collection = collectionSchema.parse(createdCollection.json());
    collectionId = collection.id;
    collectionIds.push(collection.id);

    const createdObject = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domain.id,
        type: 'concept',
        canonicalName: objectName,
        coreStatement: '',
      },
    });
    expect(createdObject.statusCode).toBe(201);
    const object = objectSummarySchema.parse(createdObject.json());
    objectId = object.id;
    objectIds.push(object.id);

    const added = await postRef({ op: 'add', objectId });
    expect(added.statusCode).toBe(200);
    const filed = documentResponseSchema.parse(added.json());
    expect(objectRefIds(filed.content)).toContain(objectId);

    const before = await db
      .select({ id: revisions.id, command: revisions.command, undoneAt: revisions.undoneAt })
      .from(revisions)
      .where(
        and(
          eq(revisions.userId, userId),
          eq(revisions.command, 'collection.add'),
          isNull(revisions.deletedAt),
          sql`${revisions.payload}->>'collectionId' = ${collectionId}`,
          sql`${revisions.payload}->>'objectId' = ${objectId}`,
        ),
      )
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(1);
    const logged = before[0];
    if (!logged) throw new Error('missing revision');
    expect(logged.undoneAt).toBeNull();
    const countBefore = await revisionCount();

    const res = await postUndo();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ undone: { id: logged.id, command: 'collection.add' } });

    const doc = await collectionDocument();
    expect(objectRefIds(doc.content)).not.toContain(objectId);
    expect(await revisionCount()).toBe(countBefore);

    const after = await db
      .select({ undoneAt: revisions.undoneAt })
      .from(revisions)
      .where(eq(revisions.id, logged.id))
      .limit(1);
    expect(after[0]?.undoneAt).not.toBeNull();
  });

  it('restores a removed ref, then undoes the add', async () => {
    const added = await postRef({ op: 'add', objectId });
    expect(added.statusCode).toBe(200);
    const removed = await postRef({ op: 'remove', objectId });
    expect(removed.statusCode).toBe(200);
    expect(objectRefIds(documentResponseSchema.parse(removed.json()).content)).not.toContain(objectId);

    const latest = await db
      .select({ command: revisions.command })
      .from(revisions)
      .where(and(eq(revisions.userId, userId), isNull(revisions.deletedAt), isNull(revisions.undoneAt)))
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(1);
    expect(latest[0]?.command).toBe('collection.remove');

    const restored = await postUndo();
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ undone: { command: 'collection.remove' } });
    const back = await collectionDocument();
    const refs = childBlocks(back.content).filter((node) => blockType(node) === 'object_ref');
    expect(refs).toHaveLength(1);
    expect(blockAttrs(refs[0]).objectId).toBe(objectId);
    expect(blockAttrs(refs[0]).label).toBe(objectName);

    const undoneAdd = await postUndo();
    expect(undoneAdd.statusCode).toBe(200);
    expect(undoneAdd.json()).toMatchObject({ undone: { command: 'collection.add' } });
    const gone = await collectionDocument();
    expect(objectRefIds(gone.content)).not.toContain(objectId);
  });

  it('keeps a paragraph when undoing a later add', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/collections/${collectionId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: SCHEMA_VERSION,
        plainText: paragraphText,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: paragraphText }],
            },
          ],
        },
      },
    });
    expect(put.statusCode).toBe(200);

    const added = await postRef({ op: 'add', objectId });
    expect(added.statusCode).toBe(200);

    const res = await postUndo();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ undone: { command: 'collection.add' } });

    const doc = await collectionDocument();
    expect(textAt(doc.content, 0)).toBe(paragraphText);
    expect(childBlocks(doc.content).map((node) => blockType(node))).toEqual(['paragraph']);
    expect(doc.plainText).toBe(paragraphText);
  });
});
