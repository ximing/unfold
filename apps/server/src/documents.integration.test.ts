import { documentResponseSchema, domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { blockIndex, documentRevisions, documents, domains, knowledgeObjects } from './db/schema.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const externalId = '11111111-1111-4111-8111-111111111111';

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

describe('documents', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const suffix = Date.now();
  const domainName = `文档领域-${suffix}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let objectId = '';
  let documentId = '';
  let savedContent: unknown;
  let savedPlainText = '';
  let savedSchemaVersion = 0;
  let savedBlockId = '';

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

  it('rejects GET /api/objects/:id/doc without a cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/objects/00000000-0000-4000-8000-000000000001/doc',
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json()).code).toBe('unauthenticated');
  });

  it('returns an empty document for a new object', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    domainIds.push(domain.id);

    const createdObject = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId: domain.id,
        type: 'concept',
        canonicalName: `文档点-${suffix}`,
        coreStatement: '',
      },
    });
    expect(createdObject.statusCode).toBe(201);
    objectId = objectSummarySchema.parse(createdObject.json()).id;
    objectIds.push(objectId);

    const rows = await db
      .select({ documentId: knowledgeObjects.documentId })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, objectId))
      .limit(1);
    documentId = rows[0]?.documentId ?? '';
    expect(documentId).not.toBe('');

    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    expect(body.content).toEqual({ type: 'doc', content: [] });
    expect(body.plainText).toBe('');
    expect(body.schemaVersion).toBe(1);
  });

  it('replaces an external paragraph id on the first save', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        plainText: '你好',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: externalId },
              content: [{ type: 'text', text: '你好' }],
            },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    const id = blockIdAt(body.content, 0);
    expect(id).not.toBe(externalId);
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(body.plainText).toBe('你好');
    savedContent = body.content;
    savedPlainText = body.plainText;
    savedSchemaVersion = body.schemaVersion;
    savedBlockId = id;
  });

  it('keeps the block id when the returned tree is saved again', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: savedSchemaVersion,
        content: savedContent,
        plainText: savedPlainText,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    expect(blockIdAt(body.content, 0)).toBe(savedBlockId);
    expect(body.plainText).toBe(savedPlainText);
  });

  it('indexes the paragraph under the document', async () => {
    const blocks = await db
      .select({
        blockType: blockIndex.blockType,
        textPreview: blockIndex.textPreview,
        position: blockIndex.position,
        parentBlockId: blockIndex.parentBlockId,
      })
      .from(blockIndex)
      .where(and(eq(blockIndex.documentId, documentId), isNull(blockIndex.deletedAt)));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.blockType).toBe('paragraph');
    expect(blocks[0]?.textPreview).toContain('你好');
    expect(blocks[0]?.position).toBe(0);
    expect(blocks[0]?.parentBlockId).toBeNull();
  });

  it('indexes object_ref by objectId instead of label', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        plainText: '状态等价',
        content: {
          type: 'doc',
          content: [
            {
              type: 'object_ref',
              attrs: { objectId, label: '状态等价' },
            },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);

    const blocks = await db
      .select({ textPreview: blockIndex.textPreview })
      .from(blockIndex)
      .where(and(eq(blockIndex.documentId, documentId), isNull(blockIndex.deletedAt)));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.textPreview).toBe(objectId);
    expect(blocks[0]?.textPreview).not.toBe('状态等价');
  });

  it('keeps only the latest 30 revisions', async () => {
    for (let i = 1; i <= 31; i += 1) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/objects/${objectId}/doc`,
        headers: { cookie },
        payload: {
          schemaVersion: 1,
          plainText: String(i),
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: String(i) }] }],
          },
        },
      });
      expect(res.statusCode).toBe(200);
    }

    const revisions = await db
      .select({ id: documentRevisions.id })
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, documentId));
    expect(revisions).toHaveLength(30);

    const docs = await db
      .select({ plainText: documents.plainText })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    expect(docs[0]?.plainText).toBe('31');
  });

  it('rejects a script node', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        plainText: '',
        content: { type: 'doc', content: [{ type: 'script' }] },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_document', message: '文档格式不正确' });
  });

  it('rejects a mismatched schema version', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 99,
        plainText: '合法',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '合法' }] }],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_document', message: '文档格式不正确' });
  });
});
