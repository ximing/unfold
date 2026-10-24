import { documentResponseSchema, domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { blockIndex, documents, domains, knowledgeObjects, sources } from './db/schema.js';

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

describe('paste', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const suffix = Date.now();
  const domainName = `粘贴领域-${suffix}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let objectId = '';
  let documentId = '';
  let savedPlainText = '';
  let sourceCount = 0;

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

  it('rejects POST /api/objects/:id/paste without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects/00000000-0000-4000-8000-000000000001/paste',
      payload: { html: '<p>外来段落</p>', plainText: '外来段落' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json()).code).toBe('unauthenticated');
  });

  it('appends pasted html and replaces an external block id', async () => {
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
        canonicalName: `粘贴点-${suffix}`,
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
      method: 'POST',
      url: `/api/objects/${objectId}/paste`,
      headers: { cookie },
      payload: {
        html: `<p data-block-id="${externalId}">外来段落</p>`,
        plainText: '外来段落',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(externalId);
    const body = documentResponseSchema.parse(res.json());
    expect(body.plainText).toContain('外来段落');

    const blocks = await db
      .select({ textPreview: blockIndex.textPreview })
      .from(blockIndex)
      .where(and(eq(blockIndex.documentId, documentId), isNull(blockIndex.deletedAt)));
    expect(blocks.some((block) => block.textPreview.includes('外来段落'))).toBe(true);
  });

  it('appends a second paste instead of replacing the document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/objects/${objectId}/paste`,
      headers: { cookie },
      payload: { html: '<p>第二段</p>', plainText: '第二段' },
    });
    expect(res.statusCode).toBe(200);
    const body = documentResponseSchema.parse(res.json());
    expect(body.plainText).toContain('外来段落');
    expect(body.plainText).toContain('第二段');
    expect(JSON.stringify(body.content)).toContain('外来段落');
    expect(JSON.stringify(body.content)).toContain('第二段');
    savedPlainText = body.plainText;
  });

  it('records a paste source for each paste', async () => {
    const rows = await db
      .select({
        kind: sources.kind,
        plainFallback: sources.plainFallback,
        contentHash: sources.contentHash,
      })
      .from(sources)
      .where(eq(sources.documentId, documentId));
    const pastes = rows.filter((row) => row.kind === 'paste');
    expect(pastes.length).toBeGreaterThanOrEqual(2);
    for (const row of pastes) {
      expect(['外来段落', '第二段']).toContain(row.plainFallback);
      expect(row.contentHash).toHaveLength(64);
    }
    sourceCount = rows.length;
  });

  it('rejects plain text over 1MB without changing the document', async () => {
    const huge = 'a'.repeat(1048577);
    const res = await app.inject({
      method: 'POST',
      url: `/api/objects/${objectId}/paste`,
      headers: { cookie },
      payload: { html: '<p>太大</p>', plainText: huge },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'payload_too_large', message: '纯文本超过 1MB' });

    const docRes = await app.inject({
      method: 'GET',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
    });
    expect(docRes.statusCode).toBe(200);
    const body = documentResponseSchema.parse(docRes.json());
    expect(body.plainText).toBe(savedPlainText);
    expect(body.plainText).not.toContain(huge);

    const rows = await db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.documentId, documentId));
    expect(rows).toHaveLength(sourceCount);
  });
});
