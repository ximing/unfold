import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { collectionSchema, documentResponseSchema, domainSchema } from '@unfold/dto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { collections, documents, domains } from './db/schema.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const requestedBlockId = '22222222-2222-4222-8222-222222222222';

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

function blockIdAt(content: unknown, index: number): string {
  if (!content || typeof content !== 'object' || !('content' in content)) {
    throw new Error('missing content');
  }
  const children = content.content;
  if (!Array.isArray(children)) throw new Error('missing content');
  const node: unknown = children[index];
  if (!node || typeof node !== 'object' || !('attrs' in node)) throw new Error('missing attrs');
  const attrs = node.attrs;
  if (!attrs || typeof attrs !== 'object' || !('id' in attrs) || typeof attrs.id !== 'string') {
    throw new Error('missing id');
  }
  return attrs.id;
}

function textAt(content: unknown, index: number): string {
  if (!content || typeof content !== 'object' || !('content' in content)) {
    throw new Error('missing content');
  }
  const children = content.content;
  if (!Array.isArray(children)) throw new Error('missing content');
  const node: unknown = children[index];
  if (!node || typeof node !== 'object' || !('content' in node) || !Array.isArray(node.content)) {
    throw new Error('missing text');
  }
  const text = node.content[0];
  if (!text || typeof text !== 'object' || !('text' in text) || typeof text.text !== 'string') {
    throw new Error('missing text');
  }
  return text.text;
}

describe('collection documents', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const suffix = Date.now();
  const domainName = `领域-${suffix}`;
  const title = `doc-${suffix}`;
  const paragraphText = `段落-${suffix}`;
  const domainIds: string[] = [];
  const collectionIds: string[] = [];
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
    cookie = cookiePair(login.headers['set-cookie']);
  });

  afterAll(async () => {
    const now = new Date();
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
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  it('rejects GET /api/collections/:id/doc without a cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/collections/${randomUUID()}/doc`,
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json())).toEqual({ code: 'unauthenticated', message: '未登录' });
  });

  it('returns the empty document created with the collection', async () => {
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

    const res = await app.inject({
      method: 'GET',
      url: `/api/collections/${collectionId}/doc`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    expect(body.content).toEqual({ type: 'doc', content: [] });
    expect(body.plainText).toBe('');
  });

  it('saves a paragraph and returns a new block id', async () => {
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
              attrs: { id: requestedBlockId },
              content: [{ type: 'text', text: paragraphText }],
            },
          ],
        },
      },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/api/collections/${collectionId}/doc`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    expect(body.plainText).toBe(paragraphText);
    expect(textAt(body.content, 0)).toBe(paragraphText);
    const id = blockIdAt(body.content, 0);
    expect(id).not.toBe(requestedBlockId);
    expect(z.uuid().safeParse(id).success).toBe(true);
  });

  it('rejects a document whose root is not doc', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/collections/${collectionId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: SCHEMA_VERSION,
        content: { type: 'paragraph' },
        plainText: 'x',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_document', message: '文档格式不正确' });
  });

  it('returns 404 for an unknown collection document', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/collections/${randomUUID()}/doc`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json())).toEqual({ code: 'not_found', message: '没有这个合集' });
  });
});
