import type { CollectionRead } from '@unfold/dto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { blockIndex, collectionReads, documents, knowledgeObjects } from './db/schema.js';

type Database = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const pendingMessage = '核心定义已更新，待确认' as const;

type IndexedBlock = {
  blockType: string;
  textPreview: string;
};

function objectIdsOf(indexed: IndexedBlock[]): string[] {
  const ids = new Set<string>();
  for (const row of indexed) {
    if (row.blockType !== 'object_ref') continue;
    if (!z.uuid().safeParse(row.textPreview).success) continue;
    ids.add(row.textPreview);
  }
  return [...ids];
}

export async function seedCollectionReads(
  tx: Tx,
  userId: string,
  documentId: string,
  indexed: IndexedBlock[],
): Promise<void> {
  const docs = await tx
    .select({ ownerType: documents.ownerType, ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  const doc = docs[0];
  if (!doc || doc.ownerType !== 'collection') return;

  const objectIds = objectIdsOf(indexed);
  if (objectIds.length === 0) return;

  const existing = await tx
    .select({ objectId: collectionReads.objectId })
    .from(collectionReads)
    .where(
      and(
        eq(collectionReads.collectionId, doc.ownerId),
        inArray(collectionReads.objectId, objectIds),
        isNull(collectionReads.deletedAt),
      ),
    );
  const seen = new Set(existing.map((row) => row.objectId));
  const missing = objectIds.filter((objectId) => !seen.has(objectId));
  if (missing.length === 0) return;

  const points = await tx
    .select({
      id: knowledgeObjects.id,
      coreStatement: knowledgeObjects.coreStatement,
      coreVersion: knowledgeObjects.coreVersion,
    })
    .from(knowledgeObjects)
    .where(
      and(
        inArray(knowledgeObjects.id, missing),
        eq(knowledgeObjects.userId, userId),
        eq(knowledgeObjects.status, 'active'),
        isNull(knowledgeObjects.deletedAt),
      ),
    );
  if (points.length === 0) return;

  await tx.insert(collectionReads).values(
    points.map((point) => ({
      userId,
      collectionId: doc.ownerId,
      objectId: point.id,
      seenCoreVersion: point.coreVersion,
      seenStatement: point.coreStatement,
    })),
  );
}

export async function pendingCollectionReads(
  db: Database,
  userId: string,
  collectionId: string,
  documentId: string | null,
): Promise<{ objectId: string; message: typeof pendingMessage }[]> {
  if (!documentId) return [];

  const rows = await db
    .select({
      objectId: knowledgeObjects.id,
      position: blockIndex.position,
    })
    .from(blockIndex)
    .innerJoin(
      knowledgeObjects,
      and(
        eq(blockIndex.textPreview, sql`(${knowledgeObjects.id})::text`),
        eq(knowledgeObjects.userId, userId),
        eq(knowledgeObjects.status, 'active'),
        isNull(knowledgeObjects.deletedAt),
      ),
    )
    .innerJoin(
      collectionReads,
      and(
        eq(collectionReads.collectionId, collectionId),
        eq(collectionReads.objectId, knowledgeObjects.id),
        isNull(collectionReads.deletedAt),
        sql`${collectionReads.seenStatement} <> ${knowledgeObjects.coreStatement}`,
      ),
    )
    .where(
      and(
        eq(blockIndex.documentId, documentId),
        eq(blockIndex.blockType, 'object_ref'),
        isNull(blockIndex.deletedAt),
      ),
    )
    .orderBy(asc(blockIndex.position));

  const pending: { objectId: string; message: typeof pendingMessage }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.objectId)) continue;
    seen.add(row.objectId);
    pending.push({ objectId: row.objectId, message: pendingMessage });
  }
  return pending;
}

export async function confirmCollectionRead(
  db: Database,
  userId: string,
  collectionId: string,
  documentId: string | null,
  objectId: string,
): Promise<CollectionRead | null> {
  return db.transaction(async (tx) => {
    const objects = await tx
      .select({
        coreStatement: knowledgeObjects.coreStatement,
        coreVersion: knowledgeObjects.coreVersion,
      })
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
    const object = objects[0];
    if (!object || !documentId) return null;

    const refs = await tx
      .select({ blockId: blockIndex.blockId })
      .from(blockIndex)
      .where(
        and(
          eq(blockIndex.documentId, documentId),
          eq(blockIndex.blockType, 'object_ref'),
          eq(blockIndex.textPreview, objectId),
          isNull(blockIndex.deletedAt),
        ),
      )
      .limit(1);
    if (!refs[0]) return null;

    const read = {
      objectId,
      seenCoreVersion: object.coreVersion,
      seenStatement: object.coreStatement,
    };
    const updated = await tx
      .update(collectionReads)
      .set({
        seenStatement: object.coreStatement,
        seenCoreVersion: object.coreVersion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(collectionReads.collectionId, collectionId),
          eq(collectionReads.objectId, objectId),
          isNull(collectionReads.deletedAt),
        ),
      )
      .returning({ objectId: collectionReads.objectId });
    if (updated[0]) return read;

    await tx.insert(collectionReads).values({
      userId,
      collectionId,
      objectId,
      seenCoreVersion: object.coreVersion,
      seenStatement: object.coreStatement,
    });
    return read;
  });
}
