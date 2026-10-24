import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { createDb } from '../db/client.js';
import { documents, knowledgeObjects, relations, suggestionNotices, suggestions } from '../db/schema.js';
import {
  mapModelItems,
  modelSuggestionFailureNotice,
  requestModelSuggestions,
  shouldRequestModel,
  type ModelCandidate,
  type ModelRequester,
} from './model.js';
import { suggestByRules, type PointKind, type RuleCandidate } from './rules.js';

type Database = ReturnType<typeof createDb>;

const POINT_KINDS = new Set<string>(['concept', 'principle', 'method', 'model', 'problem']);
const MODEL_CANDIDATE_LIMIT = 30;

function isPointKind(value: string): value is PointKind {
  return POINT_KINDS.has(value);
}

function aliasesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.some((item) => typeof item !== 'string')) return [];
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  if ('cause' in error) return isUniqueViolation(error.cause);
  return false;
}

export async function recordRuleSuggestions(
  db: Database,
  userId: string,
  objectId: string,
  model?: ModelRequester,
): Promise<void> {
  try {
    await insertRuleSuggestions(db, userId, objectId, model);
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }
}

async function writeNotice(db: Database, userId: string, objectId: string, notice: string): Promise<void> {
  const existing = await db
    .select({ id: suggestionNotices.id })
    .from(suggestionNotices)
    .where(
      and(
        eq(suggestionNotices.userId, userId),
        eq(suggestionNotices.objectId, objectId),
        isNull(suggestionNotices.deletedAt),
      ),
    )
    .limit(1);
  const now = new Date();
  if (existing[0]) {
    await db.update(suggestionNotices).set({ notice, updatedAt: now }).where(eq(suggestionNotices.id, existing[0].id));
    return;
  }
  try {
    await db.insert(suggestionNotices).values({ userId, objectId, notice });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db
      .update(suggestionNotices)
      .set({ notice, updatedAt: now })
      .where(
        and(
          eq(suggestionNotices.userId, userId),
          eq(suggestionNotices.objectId, objectId),
          isNull(suggestionNotices.deletedAt),
        ),
      );
  }
}

async function insertRuleSuggestions(
  db: Database,
  userId: string,
  objectId: string,
  model: ModelRequester | undefined,
): Promise<void> {
  const currentRows = await db
    .select({
      id: knowledgeObjects.id,
      type: knowledgeObjects.type,
      domainId: knowledgeObjects.domainId,
      canonicalName: knowledgeObjects.canonicalName,
      plainText: documents.plainText,
    })
    .from(knowledgeObjects)
    .innerJoin(
      documents,
      and(
        eq(documents.id, knowledgeObjects.documentId),
        eq(documents.userId, userId),
        eq(documents.ownerType, 'object'),
        eq(documents.ownerId, objectId),
        isNull(documents.deletedAt),
      ),
    )
    .where(
      and(
        eq(knowledgeObjects.id, objectId),
        eq(knowledgeObjects.userId, userId),
        eq(knowledgeObjects.status, 'active'),
        isNull(knowledgeObjects.deletedAt),
      ),
    )
    .limit(1);
  const current = currentRows[0];
  if (!current || !isPointKind(current.type)) return;

  const others = await db
    .select({
      id: knowledgeObjects.id,
      type: knowledgeObjects.type,
      domainId: knowledgeObjects.domainId,
      canonicalName: knowledgeObjects.canonicalName,
      aliases: knowledgeObjects.aliases,
      coreStatement: knowledgeObjects.coreStatement,
    })
    .from(knowledgeObjects)
    .where(
      and(
        eq(knowledgeObjects.userId, userId),
        eq(knowledgeObjects.status, 'active'),
        isNull(knowledgeObjects.deletedAt),
        ne(knowledgeObjects.id, objectId),
      ),
    );

  const candidates: RuleCandidate[] = [];
  for (const row of others) {
    if (!isPointKind(row.type)) continue;
    candidates.push({
      id: row.id,
      type: row.type,
      domainId: row.domainId,
      canonicalName: row.canonicalName,
      aliases: aliasesOf(row.aliases),
      coreStatement: row.coreStatement,
    });
  }

  const drafts = suggestByRules({
    objectId: current.id,
    objectType: current.type,
    domainId: current.domainId,
    canonicalName: current.canonicalName,
    plainText: current.plainText,
    candidates,
  });

  const existing = await db
    .select({ fragmentKey: suggestions.fragmentKey })
    .from(suggestions)
    .where(and(eq(suggestions.userId, userId), eq(suggestions.objectId, objectId), isNull(suggestions.deletedAt)));
  const seen = new Set(existing.map((row) => row.fragmentKey));

  for (const draft of drafts) {
    if (seen.has(draft.fragmentKey)) continue;
    seen.add(draft.fragmentKey);
    try {
      await db.insert(suggestions).values({
        userId,
        objectId,
        fragmentKey: draft.fragmentKey,
        kind: draft.kind,
        origin: 'rule',
        status: 'pending',
        summary: draft.summary,
        acceptLabel: draft.acceptLabel,
        payload: draft.payload,
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  const openRows = await db
    .select({ id: suggestions.id })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.userId, userId),
        eq(suggestions.objectId, objectId),
        isNull(suggestions.deletedAt),
        inArray(suggestions.status, ['pending', 'deferred']),
      ),
    );
  const slots = 5 - openRows.length;

  if (!shouldRequestModel(process.env)) {
    await writeNotice(db, userId, objectId, '');
    return;
  }
  if (slots <= 0) {
    await writeNotice(db, userId, objectId, '');
    return;
  }

  const candidateIds: string[] = [];
  const seenIds = new Set<string>();
  const pushId = (id: string) => {
    if (id === current.id || seenIds.has(id) || candidateIds.length >= MODEL_CANDIDATE_LIMIT) return;
    seenIds.add(id);
    candidateIds.push(id);
  };
  for (const draft of drafts) {
    if (draft.kind !== 'relation') continue;
    pushId(draft.payload.fromId);
    pushId(draft.payload.toId);
  }

  const linked = await db
    .select({ fromId: relations.fromId, toId: relations.toId })
    .from(relations)
    .where(
      and(
        eq(relations.userId, userId),
        eq(relations.status, 'accepted'),
        isNull(relations.deletedAt),
        or(eq(relations.fromId, objectId), eq(relations.toId, objectId)),
      ),
    );
  for (const row of linked) {
    pushId(row.fromId);
    pushId(row.toId);
  }

  const modelCandidates: ModelCandidate[] = [];
  if (candidateIds.length > 0) {
    const rows = await db
      .select({
        id: knowledgeObjects.id,
        canonicalName: knowledgeObjects.canonicalName,
        coreStatement: knowledgeObjects.coreStatement,
      })
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.userId, userId),
          eq(knowledgeObjects.status, 'active'),
          isNull(knowledgeObjects.deletedAt),
          inArray(knowledgeObjects.id, candidateIds),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of candidateIds) {
      const row = byId.get(id);
      if (!row) continue;
      modelCandidates.push(row);
    }
  }

  const request: ModelRequester = model ?? ((input) => requestModelSuggestions(process.env, input));
  const result = await request({
    canonicalName: current.canonicalName,
    plainText: current.plainText,
    slots,
    candidates: modelCandidates,
  });
  if (!result.ok) {
    await writeNotice(db, userId, objectId, modelSuggestionFailureNotice);
    return;
  }

  const mapped = mapModelItems({
    items: result.items,
    slots,
    current: { id: current.id, canonicalName: current.canonicalName },
    candidates: modelCandidates,
  });
  for (const item of mapped) {
    if (seen.has(item.fragmentKey)) continue;
    seen.add(item.fragmentKey);
    try {
      await db.insert(suggestions).values({
        userId,
        objectId,
        fragmentKey: item.fragmentKey,
        kind: item.kind,
        origin: 'model',
        status: 'pending',
        summary: item.summary,
        acceptLabel: item.acceptLabel,
        payload: item.payload,
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  await writeNotice(db, userId, objectId, '');
}
