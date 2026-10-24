import { SCHEMA_VERSION, type PmNode } from '@unfold/doc-schema';
import { documentBodySchema, documentResponseSchema } from '@unfold/dto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { blockIndex, documentRevisions, documents, knowledgeObjects } from './db/schema.js';
import { type SessionLookup } from './objects.js';
import { assignBlockIds, collectBlockIndex, documentNodesAllowed } from './services/document-blocks.js';

type Database = ReturnType<typeof createDb>;

const keptRevisions = 30;

const notFound = { error: { code: 'not_found', message: '没有这个点' } };
const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const invalidDocument = { error: { code: 'invalid_document', message: '文档格式不正确' } };

function uuidParam(params: unknown): string | null {
  const parsed = z.object({ id: z.uuid() }).safeParse(params);
  if (!parsed.success) return null;
  return parsed.data.id;
}

function toDocumentResponse(input: {
  schemaVersion: number;
  content: unknown;
  plainText: string;
  savedAt: Date;
}) {
  const body: unknown = {
    schemaVersion: input.schemaVersion,
    content: input.content,
    plainText: input.plainText,
    savedAt: input.savedAt.toISOString(),
  };
  return documentResponseSchema.parse(body);
}

async function ownedDocument(db: Database, userId: string, objectId: string) {
  const objects = await db
    .select({ documentId: knowledgeObjects.documentId })
    .from(knowledgeObjects)
    .where(
      and(
        eq(knowledgeObjects.id, objectId),
        eq(knowledgeObjects.userId, userId),
        eq(knowledgeObjects.status, 'active'),
        isNull(knowledgeObjects.deletedAt),
      ),
    )
    .limit(1);
  const documentId = objects[0]?.documentId;
  if (!documentId) return null;

  const docs = await db
    .select({
      id: documents.id,
      schemaVersion: documents.schemaVersion,
      contentJson: documents.contentJson,
      plainText: documents.plainText,
      savedAt: documents.savedAt,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)))
    .limit(1);
  return docs[0] ?? null;
}

export function registerDocumentRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/objects/:id/doc', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const objectId = uuidParam(request.params);
    if (!objectId) return reply.code(404).send(notFound);

    const doc = await ownedDocument(db, user.id, objectId);
    if (!doc) return reply.code(404).send(notFound);

    return reply.code(200).send(
      toDocumentResponse({
        schemaVersion: doc.schemaVersion,
        content: doc.contentJson,
        plainText: doc.plainText,
        savedAt: doc.savedAt,
      }),
    );
  });

  app.put('/api/objects/:id/doc', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const objectId = uuidParam(request.params);
    if (!objectId) return reply.code(404).send(notFound);

    const doc = await ownedDocument(db, user.id, objectId);
    if (!doc) return reply.code(404).send(notFound);

    const parsed = documentBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const content = parsed.data.content as PmNode;
    if (
      parsed.data.schemaVersion !== SCHEMA_VERSION ||
      content.type !== 'doc' ||
      !documentNodesAllowed(content)
    ) {
      return reply.code(400).send(invalidDocument);
    }

    const currentBlocks = await db
      .select({ blockId: blockIndex.blockId })
      .from(blockIndex)
      .where(and(eq(blockIndex.documentId, doc.id), isNull(blockIndex.deletedAt)));
    const keep = new Set(currentBlocks.map((row) => row.blockId));
    const assigned = assignBlockIds(content, keep);
    const indexed = collectBlockIndex(assigned);
    const savedAt = new Date();

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(documents)
        .set({
          contentJson: assigned,
          plainText: parsed.data.plainText,
          schemaVersion: SCHEMA_VERSION,
          savedAt,
          updatedAt: savedAt,
        })
        .where(and(eq(documents.id, doc.id), eq(documents.userId, user.id)))
        .returning({ id: documents.id });
      if (!updated[0]) throw new Error('update document failed');

      await tx.insert(documentRevisions).values({
        userId: user.id,
        documentId: doc.id,
        contentJson: assigned,
        savedAt,
      });

      // block_id 是主键。软删会占着 id，保留下来的块就插不回去。
      await tx.delete(blockIndex).where(eq(blockIndex.documentId, doc.id));
      if (indexed.length > 0) {
        await tx.insert(blockIndex).values(
          indexed.map((row) => ({
            blockId: row.blockId,
            userId: user.id,
            documentId: doc.id,
            parentBlockId: row.parentBlockId,
            position: row.position,
            blockType: row.blockType,
            textPreview: row.textPreview,
          })),
        );
      }

      const revisions = await tx
        .select({ id: documentRevisions.id })
        .from(documentRevisions)
        .where(eq(documentRevisions.documentId, doc.id))
        .orderBy(asc(documentRevisions.savedAt), asc(documentRevisions.createdAt));
      const overflow = revisions.length - keptRevisions;
      if (overflow > 0) {
        const staleIds = revisions.slice(0, overflow).map((revision) => revision.id);
        await tx.delete(documentRevisions).where(inArray(documentRevisions.id, staleIds));
      }
    });

    return reply.code(200).send(
      toDocumentResponse({
        schemaVersion: SCHEMA_VERSION,
        content: assigned,
        plainText: parsed.data.plainText,
        savedAt,
      }),
    );
  });
}
