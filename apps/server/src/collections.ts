import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { collectionListSchema, collectionSchema, createCollectionBodySchema } from '@unfold/dto';
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { collections, documents, domains } from './db/schema.js';
import type { SessionLookup } from './objects.js';

type Database = ReturnType<typeof createDb>;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const domainNotFound = { error: { code: 'not_found', message: '没有这个领域' } };
const collectionNotFound = { error: { code: 'not_found', message: '没有这个合集' } };
const invalidNesting = { error: { code: 'invalid_nesting', message: '合集最多嵌套一层' } };
const domainMismatch = {
  error: { code: 'domain_mismatch', message: '子合集要和父合集在同一个领域' },
};

type CreateFailure = {
  ok: false;
  status: 404 | 409;
  body: { error: { code: string; message: string } };
};

function reject(status: CreateFailure['status'], body: CreateFailure['body']): CreateFailure {
  return { ok: false, status, body };
}

const collectionColumns = {
  id: collections.id,
  domainId: collections.domainId,
  title: collections.title,
  intent: collections.intent,
  parentCollectionId: collections.parentCollectionId,
  position: collections.position,
  documentId: collections.documentId,
};

type CollectionRow = {
  id: string;
  domainId: string;
  title: string;
  intent: string;
  parentCollectionId: string | null;
  position: number;
  documentId: string | null;
};

function presentCollection(row: CollectionRow) {
  return collectionSchema.parse(row);
}

export function registerCollectionRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/collections', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createCollectionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const parentCollectionId = parsed.data.parentCollectionId ?? null;
    const outcome = await db.transaction(async (tx) => {
      const domainRows = await tx
        .select({ id: domains.id })
        .from(domains)
        .where(
          and(eq(domains.id, parsed.data.domainId), eq(domains.userId, user.id), isNull(domains.deletedAt)),
        )
        .limit(1);
      if (!domainRows[0]) return reject(404, domainNotFound);

      if (parentCollectionId) {
        const parentRows = await tx
          .select({
            domainId: collections.domainId,
            parentCollectionId: collections.parentCollectionId,
          })
          .from(collections)
          .where(
            and(
              eq(collections.id, parentCollectionId),
              eq(collections.userId, user.id),
              isNull(collections.deletedAt),
            ),
          )
          .limit(1);
        const parent = parentRows[0];
        if (!parent) return reject(404, collectionNotFound);
        if (parent.parentCollectionId) return reject(409, invalidNesting);
        if (parent.domainId !== parsed.data.domainId) return reject(409, domainMismatch);
      }

      const sameParent = parentCollectionId
        ? eq(collections.parentCollectionId, parentCollectionId)
        : isNull(collections.parentCollectionId);
      const [highest] = await tx
        .select({ position: max(collections.position) })
        .from(collections)
        .where(
          and(
            eq(collections.userId, user.id),
            eq(collections.domainId, parsed.data.domainId),
            sameParent,
            isNull(collections.deletedAt),
          ),
        );
      const position = highest?.position == null ? 0 : highest.position + 1;

      const inserted = await tx
        .insert(collections)
        .values({
          userId: user.id,
          domainId: parsed.data.domainId,
          title: parsed.data.title,
          intent: parsed.data.intent,
          parentCollectionId,
          position,
        })
        .returning({ id: collections.id });
      const created = inserted[0];
      if (!created) throw new Error('insert collection failed');

      const docs = await tx
        .insert(documents)
        .values({
          userId: user.id,
          ownerType: 'collection',
          ownerId: created.id,
          schemaVersion: SCHEMA_VERSION,
          contentJson: { type: 'doc', content: [] },
          plainText: '',
        })
        .returning({ id: documents.id });
      const document = docs[0];
      if (!document) throw new Error('insert document failed');

      await tx
        .update(collections)
        .set({ documentId: document.id, updatedAt: new Date() })
        .where(eq(collections.id, created.id));

      return {
        ok: true as const,
        collection: presentCollection({
          id: created.id,
          domainId: parsed.data.domainId,
          title: parsed.data.title,
          intent: parsed.data.intent,
          parentCollectionId,
          position,
          documentId: document.id,
        }),
      };
    });

    if (!outcome.ok) return reply.code(outcome.status).send(outcome.body);
    return reply.code(201).send(outcome.collection);
  });

  app.get('/api/collections', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = z.object({ domainId: z.uuid() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const rows = await db
      .select(collectionColumns)
      .from(collections)
      .where(
        and(
          eq(collections.userId, user.id),
          eq(collections.domainId, parsed.data.domainId),
          isNull(collections.deletedAt),
        ),
      )
      .orderBy(asc(collections.position), asc(collections.title));

    return reply.code(200).send(collectionListSchema.parse({ collections: rows.map(presentCollection) }));
  });

  app.get('/api/collections/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(collectionNotFound);

    const rows = await db
      .select(collectionColumns)
      .from(collections)
      .where(
        and(eq(collections.id, params.data.id), eq(collections.userId, user.id), isNull(collections.deletedAt)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send(collectionNotFound);
    return reply.code(200).send(presentCollection(row));
  });
}
