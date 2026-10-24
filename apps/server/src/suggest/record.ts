import { and, eq, isNull, ne } from 'drizzle-orm';
import type { createDb } from '../db/client.js';
import { documents, knowledgeObjects, suggestions } from '../db/schema.js';
import { suggestByRules, type PointKind, type RuleCandidate } from './rules.js';

type Database = ReturnType<typeof createDb>;

const POINT_KINDS = new Set<string>(['concept', 'principle', 'method', 'model', 'problem']);

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
): Promise<void> {
  try {
    await insertRuleSuggestions(db, userId, objectId);
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }
}

async function insertRuleSuggestions(db: Database, userId: string, objectId: string): Promise<void> {
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
  if (drafts.length === 0) return;

  const existing = await db
    .select({ fragmentKey: suggestions.fragmentKey })
    .from(suggestions)
    .where(
      and(eq(suggestions.userId, userId), eq(suggestions.objectId, objectId), isNull(suggestions.deletedAt)),
    );
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
}
