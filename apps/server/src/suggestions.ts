import type { PmNode } from '@unfold/doc-schema';
import {
  personalNotePayloadSchema,
  relationSuggestionPayloadSchema,
  resolveSuggestionBodySchema,
  suggestionListSchema,
  suggestionSchema,
  type Suggestion,
} from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { documents, knowledgeObjects, relations, suggestions } from './db/schema.js';
import { saveDocument } from './documents.js';
import type { SessionLookup } from './objects.js';
import { syncObjectIndex } from './services/index-sync.js';
import { validateRelation } from './services/relation-rules.js';

type Database = ReturnType<typeof createDb>;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const objectNotFound = { error: { code: 'not_found', message: '没有这个点' } };
const suggestionNotFound = { error: { code: 'not_found', message: '没有这条建议' } };
const invalidTransition = {
  error: { code: 'invalid_transition', message: '这条建议不能再改状态' },
};
const invalidSuggestion = { error: { code: 'invalid_suggestion', message: '这条建议不能执行' } };
const duplicateRelation = {
  error: { code: 'duplicate_relation', message: '这两个点之间已经有这条对照' },
};

const suggestionColumns = {
  id: suggestions.id,
  objectId: suggestions.objectId,
  fragmentKey: suggestions.fragmentKey,
  kind: suggestions.kind,
  origin: suggestions.origin,
  status: suggestions.status,
  summary: suggestions.summary,
  acceptLabel: suggestions.acceptLabel,
  payload: suggestions.payload,
  createdAt: suggestions.createdAt,
};

type SuggestionRow = {
  id: string;
  objectId: string;
  fragmentKey: string;
  kind: string;
  origin: string;
  status: string;
  summary: string;
  acceptLabel: string;
  payload: unknown;
  createdAt: Date;
};

function uuidParam(params: unknown): string | null {
  const parsed = z.object({ id: z.uuid() }).safeParse(params);
  if (!parsed.success) return null;
  return parsed.data.id;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  if ('cause' in error) return isUniqueViolation(error.cause);
  return false;
}

function canResolve(current: string, next: 'accepted' | 'deferred' | 'rejected'): boolean {
  if (current === 'pending') return true;
  if (current === 'deferred') return next === 'accepted' || next === 'rejected';
  return false;
}

function presentSuggestion(row: SuggestionRow): Suggestion | null {
  const payload =
    row.kind === 'relation'
      ? relationSuggestionPayloadSchema.safeParse(row.payload)
      : row.kind === 'personal_note'
        ? personalNotePayloadSchema.safeParse(row.payload)
        : null;
  if (!payload?.success) return null;
  const parsed = suggestionSchema.safeParse({
    id: row.id,
    objectId: row.objectId,
    fragmentKey: row.fragmentKey,
    kind: row.kind,
    origin: row.origin,
    status: row.status,
    summary: row.summary,
    acceptLabel: row.acceptLabel,
    payload: payload.data,
  });
  return parsed.success ? parsed.data : null;
}

function topLevelBlocks(content: unknown): PmNode[] {
  if (!content || typeof content !== 'object' || !('type' in content)) return [];
  const node = content as PmNode;
  if (node.type !== 'doc' || !Array.isArray(node.content)) return [];
  return node.content;
}

function appendPlainText(current: string, text: string): string {
  if (current === '') return text;
  return `${current}\n${text}`;
}

async function activeObjectExists(db: Database, userId: string, objectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: knowledgeObjects.id })
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
  return rows.length > 0;
}

async function listOpenSuggestions(db: Database, userId: string, objectId: string): Promise<Suggestion[]> {
  const rows = await db
    .select(suggestionColumns)
    .from(suggestions)
    .where(
      and(
        eq(suggestions.userId, userId),
        eq(suggestions.objectId, objectId),
        isNull(suggestions.deletedAt),
        inArray(suggestions.status, ['pending', 'deferred']),
      ),
    );
  rows.sort((a, b) => {
    const rank = (status: string) => (status === 'pending' ? 0 : 1);
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const listed: Suggestion[] = [];
  for (const row of rows) {
    const item = presentSuggestion(row);
    if (item) listed.push(item);
  }
  return listed;
}

async function ownedObjectDocument(db: Database, userId: string, objectId: string) {
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
      contentJson: documents.contentJson,
      plainText: documents.plainText,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.userId, userId),
        eq(documents.ownerType, 'object'),
        eq(documents.ownerId, objectId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);
  return docs[0] ?? null;
}

async function setSuggestionStatus(
  db: Database,
  userId: string,
  id: string,
  status: 'accepted' | 'deferred' | 'rejected',
): Promise<SuggestionRow | null> {
  const updated = await db
    .update(suggestions)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(suggestions.id, id), eq(suggestions.userId, userId), isNull(suggestions.deletedAt)))
    .returning(suggestionColumns);
  return updated[0] ?? null;
}

export function registerSuggestionRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/objects/:id/suggestions', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const objectId = uuidParam(request.params);
    if (!objectId) return reply.code(404).send(objectNotFound);
    if (!(await activeObjectExists(db, user.id, objectId))) return reply.code(404).send(objectNotFound);

    const listed = await listOpenSuggestions(db, user.id, objectId);
    return reply.code(200).send(suggestionListSchema.parse({ suggestions: listed }));
  });

  app.post('/api/suggest/:id/resolve', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const suggestionId = uuidParam(request.params);
    if (!suggestionId) return reply.code(404).send(suggestionNotFound);

    const parsed = resolveSuggestionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const found = await db
      .select(suggestionColumns)
      .from(suggestions)
      .where(
        and(eq(suggestions.id, suggestionId), eq(suggestions.userId, user.id), isNull(suggestions.deletedAt)),
      )
      .limit(1);
    const current = found[0];
    if (!current) return reply.code(404).send(suggestionNotFound);

    const next = parsed.data.status;
    if (!canResolve(current.status, next)) return reply.code(409).send(invalidTransition);

    if (next === 'deferred' || next === 'rejected') {
      const updated = await setSuggestionStatus(db, user.id, current.id, next);
      if (!updated) return reply.code(404).send(suggestionNotFound);
      const presented = presentSuggestion(updated);
      if (!presented) throw new Error('suggestion payload invalid');
      return reply.code(200).send(presented);
    }

    if (current.kind === 'relation') {
      const payload = relationSuggestionPayloadSchema.safeParse(current.payload);
      if (!payload.success) {
        return reply.code(400).send({ error: { code: 'invalid_relation', message: '请求格式不正确' } });
      }
      const validated = validateRelation(payload.data);
      if (!validated.ok) {
        return reply.code(400).send({ error: { code: validated.code, message: validated.message } });
      }
      try {
        const updated = await db.transaction(async (tx) => {
          await tx.insert(relations).values({
            userId: user.id,
            fromId: payload.data.fromId,
            toId: payload.data.toId,
            type: payload.data.type,
            distinction: payload.data.distinction,
            whatChanged: payload.data.whatChanged,
            condition: '',
            boundary: payload.data.boundary,
            note: payload.data.note,
            status: 'accepted',
            origin: current.origin,
          });
          const saved = await tx
            .update(suggestions)
            .set({ status: 'accepted', updatedAt: new Date() })
            .where(
              and(eq(suggestions.id, current.id), eq(suggestions.userId, user.id), isNull(suggestions.deletedAt)),
            )
            .returning(suggestionColumns);
          const row = saved[0];
          if (!row) throw new Error('update suggestion failed');
          return row;
        });
        const presented = presentSuggestion(updated);
        if (!presented) throw new Error('suggestion payload invalid');
        return reply.code(200).send(presented);
      } catch (error) {
        if (isUniqueViolation(error)) return reply.code(409).send(duplicateRelation);
        throw error;
      }
    }

    if (current.kind === 'personal_note') {
      const payload = personalNotePayloadSchema.safeParse(current.payload);
      if (!payload.success) return reply.code(400).send(invalidSuggestion);
      const doc = await ownedObjectDocument(db, user.id, current.objectId);
      if (!doc) return reply.code(409).send(invalidSuggestion);

      const text = payload.data.text;
      const content: PmNode = {
        type: 'doc',
        content: [
          ...topLevelBlocks(doc.contentJson),
          {
            type: 'personal_note',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          },
        ],
      };
      await saveDocument(db, user.id, doc.id, content, appendPlainText(doc.plainText, text));
      await syncObjectIndex(db, user.id, current.objectId);

      const updated = await setSuggestionStatus(db, user.id, current.id, 'accepted');
      if (!updated) return reply.code(404).send(suggestionNotFound);
      const presented = presentSuggestion(updated);
      if (!presented) throw new Error('suggestion payload invalid');
      return reply.code(200).send(presented);
    }

    return reply.code(409).send(invalidSuggestion);
  });

  app.post('/api/objects/:id/suggestions/defer', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const objectId = uuidParam(request.params);
    if (!objectId) return reply.code(404).send(objectNotFound);
    if (!(await activeObjectExists(db, user.id, objectId))) return reply.code(404).send(objectNotFound);

    const now = new Date();
    await db
      .update(suggestions)
      .set({ status: 'deferred', updatedAt: now })
      .where(
        and(
          eq(suggestions.userId, user.id),
          eq(suggestions.objectId, objectId),
          eq(suggestions.status, 'pending'),
          isNull(suggestions.deletedAt),
        ),
      );

    const listed = await listOpenSuggestions(db, user.id, objectId);
    return reply.code(200).send(suggestionListSchema.parse({ suggestions: listed }));
  });
}
