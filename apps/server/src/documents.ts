import { createHash } from 'node:crypto';
import { parsePaste, SCHEMA_VERSION, type PmNode } from '@unfold/doc-schema';
import { documentBodySchema, documentResponseSchema, pasteBodySchema } from '@unfold/dto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import {
  blockIndex,
  collections,
  documentRevisions,
  documents,
  knowledgeObjects,
  sources,
} from './db/schema.js';
import { type SessionLookup } from './objects.js';
import { assignBlockIds, collectBlockIndex, documentNodesAllowed } from './services/document-blocks.js';
import { syncObjectIndex } from './services/index-sync.js';

type Database = ReturnType<typeof createDb>;

const keptRevisions = 30;
const maxPlainTextBytes = 1048576;
// JSON 包一层就会超过纯文本上限，默认 bodyLimit 会先 413，到不了下面的检查。
const pasteBodyLimit = 8 * maxPlainTextBytes;

const notFound = { error: { code: 'not_found', message: '没有这个点' } };
const collectionNotFound = { error: { code: 'not_found', message: '没有这个合集' } };
const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const invalidDocument = { error: { code: 'invalid_document', message: '文档格式不正确' } };
const payloadTooLarge = { error: { code: 'payload_too_large', message: '纯文本超过 1MB' } };

type PasteSource = {
  plainFallback: string;
  contentHash: string;
};

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

async function ownedCollectionDocument(db: Database, userId: string, collectionId: string) {
  const rows = await db
    .select({ documentId: collections.documentId })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId), isNull(collections.deletedAt)))
    .limit(1);
  const documentId = rows[0]?.documentId;
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

function docBlocks(content: unknown): PmNode[] {
  if (content === null || typeof content !== 'object' || !('type' in content)) return [];
  const node = content as PmNode;
  if (node.type !== 'doc' || !Array.isArray(node.content)) return [];
  return node.content;
}

function appendPaste(current: unknown, pasted: PmNode): PmNode {
  const extra = Array.isArray(pasted.content) ? pasted.content : [];
  return { type: 'doc', content: [...docBlocks(current), ...extra] };
}

function mergePlainText(current: string, incoming: string): string {
  if (current !== '' && incoming !== '') return `${current}\n\n${incoming}`;
  if (incoming !== '') return incoming;
  return current;
}

function hashPaste(plainText: string, html: string): string {
  return createHash('sha256').update(plainText).update('\0').update(html).digest('hex');
}

export async function saveDocument(
  db: Database,
  userId: string,
  documentId: string,
  content: PmNode,
  plainText: string,
  source?: PasteSource,
) {
  const currentBlocks = await db
    .select({ blockId: blockIndex.blockId })
    .from(blockIndex)
    .where(and(eq(blockIndex.documentId, documentId), isNull(blockIndex.deletedAt)));
  const keep = new Set(currentBlocks.map((row) => row.blockId));
  const assigned = assignBlockIds(content, keep);
  const indexed = collectBlockIndex(assigned);
  const savedAt = new Date();

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(documents)
      .set({
        contentJson: assigned,
        plainText,
        schemaVersion: SCHEMA_VERSION,
        savedAt,
        updatedAt: savedAt,
      })
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .returning({ id: documents.id });
    if (!updated[0]) throw new Error('update document failed');

    await tx.insert(documentRevisions).values({
      userId,
      documentId,
      contentJson: assigned,
      savedAt,
    });

    if (source) {
      await tx.insert(sources).values({
        userId,
        documentId,
        kind: 'paste',
        locator: '',
        plainFallback: source.plainFallback,
        contentHash: source.contentHash,
      });
    }

    // block_id 是主键。软删会占着 id，保留下来的块就插不回去。
    await tx.delete(blockIndex).where(eq(blockIndex.documentId, documentId));
    if (indexed.length > 0) {
      await tx.insert(blockIndex).values(
        indexed.map((row) => ({
          blockId: row.blockId,
          userId,
          documentId,
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
      .where(eq(documentRevisions.documentId, documentId))
      .orderBy(asc(documentRevisions.savedAt), asc(documentRevisions.createdAt));
    const overflow = revisions.length - keptRevisions;
    if (overflow > 0) {
      const staleIds = revisions.slice(0, overflow).map((revision) => revision.id);
      await tx.delete(documentRevisions).where(inArray(documentRevisions.id, staleIds));
    }
  });

  return { content: assigned, plainText, savedAt };
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

    const saved = await saveDocument(db, user.id, doc.id, content, parsed.data.plainText);
    await syncObjectIndex(db, user.id, objectId);
    return reply.code(200).send(
      toDocumentResponse({
        schemaVersion: SCHEMA_VERSION,
        content: saved.content,
        plainText: saved.plainText,
        savedAt: saved.savedAt,
      }),
    );
  });

  app.post('/api/objects/:id/paste', { bodyLimit: pasteBodyLimit }, async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const objectId = uuidParam(request.params);
    if (!objectId) return reply.code(404).send(notFound);

    const doc = await ownedDocument(db, user.id, objectId);
    if (!doc) return reply.code(404).send(notFound);

    const parsed = pasteBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const { html, plainText } = parsed.data;
    if (html === '' && plainText === '') return reply.code(400).send(invalidBody);
    if (Buffer.byteLength(plainText, 'utf8') > maxPlainTextBytes) {
      return reply.code(400).send(payloadTooLarge);
    }

    const pasted = parsePaste(html, plainText);
    const saved = await saveDocument(
      db,
      user.id,
      doc.id,
      appendPaste(doc.contentJson, pasted.content),
      mergePlainText(doc.plainText, plainText),
      {
        plainFallback: plainText,
        contentHash: hashPaste(plainText, html),
      },
    );
    await syncObjectIndex(db, user.id, objectId);

    return reply.code(200).send(
      toDocumentResponse({
        schemaVersion: SCHEMA_VERSION,
        content: saved.content,
        plainText: saved.plainText,
        savedAt: saved.savedAt,
      }),
    );
  });

  app.get('/api/collections/:id/doc', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const collectionId = uuidParam(request.params);
    if (!collectionId) return reply.code(404).send(collectionNotFound);

    const doc = await ownedCollectionDocument(db, user.id, collectionId);
    if (!doc) return reply.code(404).send(collectionNotFound);

    return reply.code(200).send(
      toDocumentResponse({
        schemaVersion: doc.schemaVersion,
        content: doc.contentJson,
        plainText: doc.plainText,
        savedAt: doc.savedAt,
      }),
    );
  });

  app.put('/api/collections/:id/doc', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const collectionId = uuidParam(request.params);
    if (!collectionId) return reply.code(404).send(collectionNotFound);

    const doc = await ownedCollectionDocument(db, user.id, collectionId);
    if (!doc) return reply.code(404).send(collectionNotFound);

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

    const saved = await saveDocument(db, user.id, doc.id, content, parsed.data.plainText);
    return reply.code(200).send(
      toDocumentResponse({
        schemaVersion: SCHEMA_VERSION,
        content: saved.content,
        plainText: saved.plainText,
        savedAt: saved.savedAt,
      }),
    );
  });
}
