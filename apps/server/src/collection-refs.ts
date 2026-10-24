import { SCHEMA_VERSION, type PmNode } from '@unfold/doc-schema';
import { collectionRefBodySchema, documentResponseSchema, type CollectionRefBody } from '@unfold/dto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { collections, documents, knowledgeObjects, revisions } from './db/schema.js';
import { saveDocument } from './documents.js';
import type { SessionLookup } from './objects.js';

type Database = ReturnType<typeof createDb>;

const keptRevisions = 50;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const collectionNotFound = { error: { code: 'not_found', message: '没有这个合集' } };
const objectNotFound = { error: { code: 'not_found', message: '没有这个点' } };
const notInCollection = { error: { code: 'not_found', message: '这个合集里没有这个点' } };
const alreadyFiled = { error: { code: 'already_filed', message: '这个点已经在这个合集里' } };

type Failure = {
  ok: false;
  status: 400 | 404 | 409;
  body: { error: { code: string; message: string } };
};

type RefCommand = 'collection.add' | 'collection.remove' | 'collection.move';

type RefChange = {
  ok: true;
  blocks: PmNode[];
  command: RefCommand;
  payload: { collectionId: string; objectId: string; position?: number };
  inverse: { command: RefCommand; collectionId: string; objectId: string; position?: number };
};

function fail(status: Failure['status'], body: Failure['body']): Failure {
  return { ok: false, status, body };
}

export function topLevelBlocks(content: unknown): PmNode[] {
  if (!content || typeof content !== 'object') return [];
  const node = content as PmNode;
  if (node.type !== 'doc' || !Array.isArray(node.content)) return [];
  return node.content;
}

export function replaceBlocks(content: unknown, blocks: PmNode[]): PmNode {
  if (content && typeof content === 'object' && (content as PmNode).type === 'doc') {
    return { ...(content as PmNode), content: blocks };
  }
  return { type: 'doc', content: blocks };
}

function refObjectId(node: PmNode | undefined): string | null {
  if (!node || node.type !== 'object_ref') return null;
  const objectId = node.attrs?.objectId;
  if (typeof objectId !== 'string' || objectId.length === 0) return null;
  return objectId;
}

function objectRefSlots(blocks: PmNode[]): number[] {
  const slots: number[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    if (refObjectId(blocks[index])) slots.push(index);
  }
  return slots;
}

function toDocumentResponse(input: {
  schemaVersion: number;
  content: unknown;
  plainText: string;
  savedAt: Date;
}) {
  return documentResponseSchema.parse({
    schemaVersion: input.schemaVersion,
    content: input.content,
    plainText: input.plainText,
    savedAt: input.savedAt.toISOString(),
  });
}

export async function ownedCollectionDocument(db: Database, userId: string, collectionId: string) {
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
      contentJson: documents.contentJson,
      plainText: documents.plainText,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)))
    .limit(1);
  return docs[0] ?? null;
}

export async function activeObject(db: Database, userId: string, objectId: string) {
  const rows = await db
    .select({ canonicalName: knowledgeObjects.canonicalName })
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
  return rows[0] ?? null;
}

// position 是顶层 object_ref 下标：插在该条之前；缺省或越界则接到文档末尾。
export function insertObjectRef(
  blocks: PmNode[],
  objectId: string,
  label: string,
  position?: number,
): PmNode[] | null {
  if (position !== undefined && (!Number.isInteger(position) || position < 0)) return null;
  const slots = objectRefSlots(blocks);
  for (const slot of slots) {
    if (refObjectId(blocks[slot]) === objectId) return null;
  }
  const ref: PmNode = { type: 'object_ref', attrs: { objectId, label } };
  if (position === undefined || position >= slots.length) return [...blocks, ref];
  const at = slots[position];
  if (at === undefined) return [...blocks, ref];
  const next = blocks.slice();
  next.splice(at, 0, ref);
  return next;
}

export function removeObjectRef(
  blocks: PmNode[],
  objectId: string,
): { blocks: PmNode[]; position: number } | null {
  const slots = objectRefSlots(blocks);
  const position = slots.findIndex((slot) => refObjectId(blocks[slot]) === objectId);
  if (position < 0) return null;
  return {
    blocks: blocks.filter((node) => refObjectId(node) !== objectId),
    position,
  };
}

// 非引用块留在原来的下标，只重排顶层 object_ref 槽位。
export function moveObjectRef(blocks: PmNode[], objectId: string, position: number): PmNode[] | null {
  if (!Number.isInteger(position) || position < 0) return null;
  const slots = objectRefSlots(blocks);
  const from = slots.findIndex((slot) => refObjectId(blocks[slot]) === objectId);
  if (from < 0) return null;
  if (position > slots.length - 1) return null;

  const refs: PmNode[] = [];
  for (const slot of slots) {
    const node = blocks[slot];
    if (!node) return null;
    refs.push(node);
  }
  const moved = refs[from];
  if (!moved) return null;
  refs.splice(from, 1);
  refs.splice(position, 0, moved);

  const next = blocks.slice();
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const node = refs[index];
    if (slot === undefined || !node) continue;
    next[slot] = node;
  }
  return next;
}

function fileObject(blocks: PmNode[], collectionId: string, objectId: string, label: string): RefChange | Failure {
  const next = insertObjectRef(blocks, objectId, label);
  if (!next) return fail(409, alreadyFiled);
  return {
    ok: true,
    blocks: next,
    command: 'collection.add',
    payload: { collectionId, objectId },
    inverse: { command: 'collection.remove', collectionId, objectId },
  };
}

function unfileObject(blocks: PmNode[], collectionId: string, objectId: string): RefChange | Failure {
  const removed = removeObjectRef(blocks, objectId);
  if (!removed) return fail(404, notInCollection);
  return {
    ok: true,
    blocks: removed.blocks,
    command: 'collection.remove',
    payload: { collectionId, objectId, position: removed.position },
    inverse: { command: 'collection.add', collectionId, objectId, position: removed.position },
  };
}

function moveObject(
  blocks: PmNode[],
  collectionId: string,
  objectId: string,
  position: number,
): RefChange | Failure {
  const slots = objectRefSlots(blocks);
  const from = slots.findIndex((slot) => refObjectId(blocks[slot]) === objectId);
  if (from < 0) return fail(404, notInCollection);
  if (position > slots.length - 1) return fail(400, invalidBody);
  const next = moveObjectRef(blocks, objectId, position);
  if (!next) return fail(404, notInCollection);
  return {
    ok: true,
    blocks: next,
    command: 'collection.move',
    payload: { collectionId, objectId, position },
    inverse: { command: 'collection.move', collectionId, objectId, position: from },
  };
}

function applyRefOp(
  blocks: PmNode[],
  collectionId: string,
  body: CollectionRefBody,
  label: string,
): RefChange | Failure {
  if (body.op === 'add') return fileObject(blocks, collectionId, body.objectId, label);
  if (body.op === 'remove') return unfileObject(blocks, collectionId, body.objectId);
  return moveObject(blocks, collectionId, body.objectId, body.position);
}

async function recordRevision(db: Database, userId: string, change: RefChange) {
  await db.transaction(async (tx) => {
    await tx.insert(revisions).values({
      userId,
      command: change.command,
      payload: change.payload,
      inverse: change.inverse,
    });
    const open = await tx
      .select({ id: revisions.id })
      .from(revisions)
      .where(and(eq(revisions.userId, userId), isNull(revisions.deletedAt), isNull(revisions.undoneAt)))
      .orderBy(asc(revisions.createdAt), asc(revisions.id));
    const overflow = open.length - keptRevisions;
    if (overflow <= 0) return;
    const staleIds = open.slice(0, overflow).map((row) => row.id);
    const now = new Date();
    await tx.update(revisions).set({ deletedAt: now, updatedAt: now }).where(inArray(revisions.id, staleIds));
  });
}

export function registerCollectionRefRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/collections/:id/refs', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(collectionNotFound);

    const collectionId = params.data.id;
    const doc = await ownedCollectionDocument(db, user.id, collectionId);
    if (!doc) return reply.code(404).send(collectionNotFound);

    const parsed = collectionRefBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const object = await activeObject(db, user.id, parsed.data.objectId);
    if (!object) return reply.code(404).send(objectNotFound);

    const change = applyRefOp(topLevelBlocks(doc.contentJson), collectionId, parsed.data, object.canonicalName);
    if (!change.ok) return reply.code(change.status).send(change.body);

    const saved = await saveDocument(
      db,
      user.id,
      doc.id,
      replaceBlocks(doc.contentJson, change.blocks),
      doc.plainText,
    );
    await recordRevision(db, user.id, change);

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
