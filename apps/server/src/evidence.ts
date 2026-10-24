import { createEvidenceBodySchema, evidenceSchema, type Evidence } from '@unfold/dto';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { capabilities, capabilityObjects, evidence, reviewStates } from './db/schema.js';
import type { SessionLookup } from './objects.js';
import { independentLock, transferPracticeAllowed } from './services/evidence-rules.js';
import { replayReviews, type ReviewRating } from './services/review.js';

type Database = ReturnType<typeof createDb>;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const capabilityNotFound = { error: { code: 'not_found', message: '没有这个能力' } };
const databaseUnavailable = { error: { code: 'database_unavailable', message: '数据库暂时不可用' } };
const paramsSchema = z.object({ id: z.uuid() });

const reviewRatings = ['fail', 'partial', 'with_hint', 'independent', 'saw_material'] as const;

function asRating(value: string): ReviewRating {
  if ((reviewRatings as readonly string[]).includes(value)) return value as ReviewRating;
  throw new Error(`unexpected rating: ${value}`);
}

export async function rebuildReviewState(db: Database, userId: string, capabilityId: string): Promise<void> {
  const rows = await db
    .select({
      id: evidence.id,
      rating: evidence.rating,
      createdAt: evidence.createdAt,
    })
    .from(evidence)
    .where(and(eq(evidence.userId, userId), eq(evidence.capabilityId, capabilityId), isNull(evidence.deletedAt)))
    .orderBy(asc(evidence.createdAt), asc(evidence.id));
  const snapshot = replayReviews(rows.map((row) => ({ rating: asRating(row.rating), at: row.createdAt })));
  if (!snapshot) return;
  const existing = await db
    .select({ id: reviewStates.id })
    .from(reviewStates)
    .where(
      and(eq(reviewStates.userId, userId), eq(reviewStates.capabilityId, capabilityId), isNull(reviewStates.deletedAt)),
    )
    .limit(1);
  const current = existing[0];
  if (current) {
    await db
      .update(reviewStates)
      .set({
        stability: snapshot.stability,
        difficulty: snapshot.difficulty,
        dueAt: snapshot.dueAt,
        reps: snapshot.reps,
        lapses: snapshot.lapses,
        updatedAt: new Date(),
      })
      .where(eq(reviewStates.id, current.id));
    return;
  }
  await db.insert(reviewStates).values({
    userId,
    capabilityId,
    stability: snapshot.stability,
    difficulty: snapshot.difficulty,
    dueAt: snapshot.dueAt,
    reps: snapshot.reps,
    lapses: snapshot.lapses,
  });
}

async function siblingHasIndependent(db: Database, userId: string, primaryObjectId: string): Promise<boolean> {
  const owned = await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.userId, userId),
        eq(capabilities.primaryObjectId, primaryObjectId),
        ne(capabilities.kind, 'transfer'),
        isNull(capabilities.deletedAt),
      ),
    );
  const linked = await db
    .select({ capabilityId: capabilityObjects.capabilityId })
    .from(capabilityObjects)
    .where(
      and(
        eq(capabilityObjects.userId, userId),
        eq(capabilityObjects.objectId, primaryObjectId),
        isNull(capabilityObjects.deletedAt),
      ),
    );
  const ids = [...new Set([...owned.map((row) => row.id), ...linked.map((row) => row.capabilityId)])];
  if (ids.length === 0) return false;
  const nonTransfer = await db
    .select({ id: capabilities.id })
    .from(capabilities)
    .where(
      and(
        inArray(capabilities.id, ids),
        eq(capabilities.userId, userId),
        ne(capabilities.kind, 'transfer'),
        isNull(capabilities.deletedAt),
      ),
    );
  if (nonTransfer.length === 0) return false;
  const hit = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        inArray(
          evidence.capabilityId,
          nonTransfer.map((row) => row.id),
        ),
        eq(evidence.userId, userId),
        eq(evidence.rating, 'independent'),
        isNull(evidence.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(hit[0]);
}

function presentEvidence(row: {
  id: string;
  capabilityId: string;
  mode: string;
  hintLevel: number;
  rating: string;
  obstacle: string;
  body: string;
  createdAt: Date;
}): Evidence {
  return evidenceSchema.parse({
    id: row.id,
    capabilityId: row.capabilityId,
    mode: row.mode,
    hintLevel: row.hintLevel,
    rating: row.rating,
    obstacle: row.obstacle,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  });
}

export function registerEvidenceRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/capabilities/:id/evidence', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = paramsSchema.safeParse(request.params);
    const body = createEvidenceBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(invalidBody);

    try {
      const outcome = await db.transaction(async (tx) => {
        const query = tx as unknown as Database;
        const found = await query
          .select({
            id: capabilities.id,
            kind: capabilities.kind,
            hintThreshold: capabilities.hintThreshold,
            primaryObjectId: capabilities.primaryObjectId,
          })
          .from(capabilities)
          .where(
            and(eq(capabilities.id, params.data.id), eq(capabilities.userId, user.id), isNull(capabilities.deletedAt)),
          )
          .limit(1);
        const capability = found[0];
        if (!capability) return { type: 'missing' as const };

        const sibling =
          capability.kind === 'transfer'
            ? await siblingHasIndependent(query, user.id, capability.primaryObjectId)
            : true;
        const gate = transferPracticeAllowed({ kind: capability.kind, siblingHasIndependent: sibling });
        if (!gate.allowed) return { type: 'locked' as const, code: 'transfer_locked' as const, message: gate.message };

        if (body.data.rating === 'independent') {
          const lock = independentLock(body.data.hintLevel, capability.hintThreshold);
          if (lock.locked) {
            return { type: 'locked' as const, code: 'independent_locked' as const, message: lock.message };
          }
        }

        const inserted = await query
          .insert(evidence)
          .values({
            userId: user.id,
            capabilityId: capability.id,
            mode: body.data.mode,
            hintLevel: body.data.hintLevel,
            rating: body.data.rating,
            obstacle: body.data.obstacle,
            body: body.data.body,
          })
          .returning({
            id: evidence.id,
            capabilityId: evidence.capabilityId,
            mode: evidence.mode,
            hintLevel: evidence.hintLevel,
            rating: evidence.rating,
            obstacle: evidence.obstacle,
            body: evidence.body,
            createdAt: evidence.createdAt,
          });
        const created = inserted[0];
        if (!created) throw new Error('insert evidence failed');
        await rebuildReviewState(query, user.id, capability.id);
        return { type: 'created' as const, evidence: presentEvidence(created) };
      });

      if (outcome.type === 'missing') return reply.code(404).send(capabilityNotFound);
      if (outcome.type === 'locked') {
        return reply.code(409).send({ error: { code: outcome.code, message: outcome.message } });
      }
      return reply.code(201).send(outcome.evidence);
    } catch {
      return reply.code(500).send(databaseUnavailable);
    }
  });
}
