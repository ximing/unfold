import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { collectionSchema, documentResponseSchema, domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { blockIndex, collections, documents, domains, knowledgeObjects, revisions, users } from './db/schema.js';

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

describe('collection refs', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const suffix = Date.now();
  const domainName = `领域-${suffix}`;
  const title = `合集-${suffix}`;
  const objectName = `点-${suffix}`;
  const leftName = `左-${suffix}`;
  const rightName = `右-${suffix}`;
  const citedName = `引用-${suffix}`;
  const capName = `上限-${suffix}`;
  const paragraphText = `段落-${suffix}`;
  const domainIds: string[] = [];
  const collectionIds: string[] = [];
  const objectIds: string[] = [];
  let collectionId = '';
  let documentId = '';
  let objectId = '';
  let leftId = '';
  let rightId = '';

  beforeAll(async () => {
    app = await buildApp();
    pool = createPool();
    db = createDb(pool);
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
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

  async function createObject(canonicalName: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domainIds[0],
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

  async function postRef(payload: { op: 'add' | 'remove' | 'move'; objectId: string; position?: number }) {
    return app.inject({
      method: 'POST',
      url: `/api/collections/${collectionId}/refs`,
      headers: { cookie },
      payload,
    });
  }

  async function latestRevision() {
    const rows = await db
      .select({
        command: revisions.command,
        payload: revisions.payload,
        inverse: revisions.inverse,
      })
      .from(revisions)
      .where(
        and(
          eq(revisions.userId, userId),
          isNull(revisions.deletedAt),
          sql`${revisions.payload}->>'collectionId' = ${collectionId}`,
        ),
      )
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('missing revision');
    return row;
  }

  it('rejects POST /api/collections/:id/refs without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/collections/${randomUUID()}/refs`,
      payload: { op: 'add', objectId: randomUUID() },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json())).toEqual({ code: 'unauthenticated', message: '未登录' });
  });

  it('appends an object_ref and logs collection.add', async () => {
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
    if (!collection.documentId) throw new Error('missing document');
    documentId = collection.documentId;

    objectId = await createObject(objectName);

    const res = await postRef({ op: 'add', objectId });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    const blocks = childBlocks(body.content);
    const last = blocks[blocks.length - 1];
    expect(blockType(last)).toBe('object_ref');
    const attrs = blockAttrs(last);
    expect(attrs.objectId).toBe(objectId);
    expect(attrs.label).toBe(objectName);
    expect(body.plainText).toBe('');

    const indexed = await db
      .select({ textPreview: blockIndex.textPreview })
      .from(blockIndex)
      .where(
        and(
          eq(blockIndex.documentId, documentId),
          eq(blockIndex.blockType, 'object_ref'),
          isNull(blockIndex.deletedAt),
        ),
      );
    expect(indexed).toHaveLength(1);
    expect(indexed[0]?.textPreview).toBe(objectId);
    expect(indexed[0]?.textPreview).not.toBe(objectName);

    const logged = await db
      .select({ command: revisions.command, inverse: revisions.inverse })
      .from(revisions)
      .where(
        and(
          eq(revisions.userId, userId),
          eq(revisions.command, 'collection.add'),
          isNull(revisions.deletedAt),
          isNull(revisions.undoneAt),
          sql`${revisions.payload}->>'collectionId' = ${collectionId}`,
          sql`${revisions.payload}->>'objectId' = ${objectId}`,
        ),
      );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.inverse).toEqual({
      command: 'collection.remove',
      collectionId,
      objectId,
    });
  });

  it('rejects filing the same object twice', async () => {
    const res = await postRef({ op: 'add', objectId });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res.json())).toEqual({
      code: 'already_filed',
      message: '这个点已经在这个合集里',
    });
  });

  it('moves the second ref to position 0 and leaves the paragraph', async () => {
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

    leftId = await createObject(leftName);
    rightId = await createObject(rightName);
    const first = await postRef({ op: 'add', objectId: leftId });
    expect(first.statusCode).toBe(200);
    const second = await postRef({ op: 'add', objectId: rightId });
    expect(second.statusCode).toBe(200);

    const res = await postRef({ op: 'move', objectId: rightId, position: 0 });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    const blocks = childBlocks(body.content);
    expect(blocks.map((block) => blockType(block))).toEqual(['paragraph', 'object_ref', 'object_ref']);
    expect(textAt(body.content, 0)).toBe(paragraphText);
    expect(blockAttrs(blocks[1]).objectId).toBe(rightId);
    expect(blockAttrs(blocks[2]).objectId).toBe(leftId);
    expect(body.plainText).toBe(paragraphText);

    const logged = await latestRevision();
    expect(logged.command).toBe('collection.move');
    expect(logged.payload).toEqual({ collectionId, objectId: rightId, position: 0 });
    expect(logged.inverse).toEqual({
      command: 'collection.move',
      collectionId,
      objectId: rightId,
      position: 1,
    });
  });

  it('removes a ref and records its previous index', async () => {
    const res = await postRef({ op: 'remove', objectId: leftId });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    const blocks = childBlocks(body.content);
    expect(blocks.map((block) => blockType(block))).toEqual(['paragraph', 'object_ref']);
    expect(textAt(body.content, 0)).toBe(paragraphText);
    expect(blockAttrs(blocks[1]).objectId).toBe(rightId);

    const logged = await latestRevision();
    expect(logged.command).toBe('collection.remove');
    expect(logged.payload).toEqual({ collectionId, objectId: leftId, position: 1 });
  });

  it('counts a collection object_ref when deleting, then allows delete after remove', async () => {
    const citedId = await createObject(citedName);
    const added = await postRef({ op: 'add', objectId: citedId });
    expect(added.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${citedId}`,
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(409);
    const message = errorOf(blocked.json()).message;
    const matched = message.match(/^还有 (\d+) 处引用这个点$/);
    expect(matched).not.toBeNull();
    expect(Number(matched?.[1])).toBeGreaterThanOrEqual(1);

    const removed = await postRef({ op: 'remove', objectId: citedId });
    expect(removed.statusCode).toBe(200);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/objects/${citedId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('keeps the newest 50 open revisions after another add', async () => {
    await db.insert(revisions).values(
      Array.from({ length: 50 }, () => {
        const fillerId = randomUUID();
        return {
          userId,
          command: 'collection.add',
          payload: { collectionId, objectId: fillerId },
          inverse: { command: 'collection.remove', collectionId, objectId: fillerId },
        };
      }),
    );

    const capId = await createObject(capName);
    const res = await postRef({ op: 'add', objectId: capId });
    expect(res.statusCode).toBe(200);

    const open = await db
      .select({ command: revisions.command, payload: revisions.payload })
      .from(revisions)
      .where(and(eq(revisions.userId, userId), isNull(revisions.deletedAt), isNull(revisions.undoneAt)))
      .orderBy(desc(revisions.createdAt), desc(revisions.id));
    expect(open).toHaveLength(50);
    expect(open[0]?.command).toBe('collection.add');
    expect(open[0]?.payload).toEqual({ collectionId, objectId: capId });
  });
});
