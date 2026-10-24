import type { PmNode } from '@unfold/doc-schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  activeObject,
  insertObjectRef,
  moveObjectRef,
  ownedCollectionDocument,
  removeObjectRef,
  replaceBlocks,
  topLevelBlocks,
} from './collection-refs.js';
import type { createDb } from './db/client.js';
import { revisions } from './db/schema.js';
import { saveDocument } from './documents.js';
import type { SessionLookup } from './objects.js';

type Database = ReturnType<typeof createDb>;

const notFound = { error: { code: 'not_found', message: '没有可撤销的结构命令' } };
const invalidRevision = { error: { code: 'invalid_revision', message: '这条结构命令已经对不上文档' } };

const undoResponseSchema = z.object({
  undone: z.object({
    id: z.uuid(),
    command: z.string(),
  }),
});

const inverseSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('collection.remove'),
    collectionId: z.uuid(),
    objectId: z.uuid(),
  }),
  z.object({
    command: z.literal('collection.add'),
    collectionId: z.uuid(),
    objectId: z.uuid(),
    position: z.int().nonnegative().optional(),
  }),
  z.object({
    command: z.literal('collection.move'),
    collectionId: z.uuid(),
    objectId: z.uuid(),
    position: z.int().nonnegative().optional(),
  }),
]);

type Inverse = z.infer<typeof inverseSchema>;

function nextBlocks(blocks: PmNode[], inverse: Inverse, label: string | null): PmNode[] | null {
  if (inverse.command === 'collection.remove') {
    return removeObjectRef(blocks, inverse.objectId)?.blocks ?? null;
  }
  if (inverse.command === 'collection.add') {
    if (label === null) return null;
    return insertObjectRef(blocks, inverse.objectId, label, inverse.position);
  }
  if (inverse.position === undefined) return null;
  return moveObjectRef(blocks, inverse.objectId, inverse.position);
}

export function registerUndoRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/undo', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const rows = await db
      .select({
        id: revisions.id,
        command: revisions.command,
        inverse: revisions.inverse,
      })
      .from(revisions)
      .where(and(eq(revisions.userId, user.id), isNull(revisions.deletedAt), isNull(revisions.undoneAt)))
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send(notFound);

    const parsed = inverseSchema.safeParse(row.inverse);
    if (!parsed.success) return reply.code(409).send(invalidRevision);

    const inverse = parsed.data;
    const doc = await ownedCollectionDocument(db, user.id, inverse.collectionId);
    if (!doc) return reply.code(409).send(invalidRevision);

    let label: string | null = null;
    if (inverse.command === 'collection.add') {
      const object = await activeObject(db, user.id, inverse.objectId);
      if (!object) return reply.code(409).send(invalidRevision);
      label = object.canonicalName;
    }

    const blocks = nextBlocks(topLevelBlocks(doc.contentJson), inverse, label);
    if (!blocks) return reply.code(409).send(invalidRevision);

    await saveDocument(db, user.id, doc.id, replaceBlocks(doc.contentJson, blocks), doc.plainText);

    const now = new Date();
    await db
      .update(revisions)
      .set({ undoneAt: now, updatedAt: now })
      .where(and(eq(revisions.id, row.id), isNull(revisions.deletedAt), isNull(revisions.undoneAt)));

    return reply.code(200).send(
      undoResponseSchema.parse({
        undone: { id: row.id, command: row.command },
      }),
    );
  });
}
