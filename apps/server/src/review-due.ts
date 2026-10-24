import { dueCapabilitySchema, type DueCapability } from '@unfold/dto';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { createDb } from './db/client.js';
import { capabilities, evidence, reviewStates } from './db/schema.js';
import type { SessionLookup } from './objects.js';

type Database = ReturnType<typeof createDb>;

const databaseUnavailable = { error: { code: 'database_unavailable', message: '数据库暂时不可用' } };

function evidenceNote(obstacle: string, body: string): string {
  return obstacle.trim() !== '' ? obstacle : body;
}

export async function listDueCapabilities(db: Database, userId: string, now: Date): Promise<DueCapability[]> {
  const states = await db
    .select({
      capabilityId: reviewStates.capabilityId,
      dueAt: reviewStates.dueAt,
      statement: capabilities.statement,
    })
    .from(reviewStates)
    .innerJoin(capabilities, eq(capabilities.id, reviewStates.capabilityId))
    .where(
      and(
        eq(reviewStates.userId, userId),
        isNull(reviewStates.deletedAt),
        lte(reviewStates.dueAt, now),
        eq(capabilities.userId, userId),
        isNull(capabilities.deletedAt),
      ),
    )
    .orderBy(asc(reviewStates.dueAt), asc(reviewStates.capabilityId));
  if (states.length === 0) return [];

  const notes = await db
    .select({
      capabilityId: evidence.capabilityId,
      obstacle: evidence.obstacle,
      body: evidence.body,
    })
    .from(evidence)
    .where(
      and(
        inArray(
          evidence.capabilityId,
          states.map((row) => row.capabilityId),
        ),
        eq(evidence.userId, userId),
        isNull(evidence.deletedAt),
      ),
    )
    .orderBy(desc(evidence.createdAt), desc(evidence.id));

  const noteByCapability = new Map<string, string>();
  for (const note of notes) {
    if (noteByCapability.has(note.capabilityId)) continue;
    noteByCapability.set(note.capabilityId, evidenceNote(note.obstacle, note.body));
  }

  return states.map((row) =>
    dueCapabilitySchema.parse({
      capabilityId: row.capabilityId,
      statement: row.statement,
      evidenceNote: noteByCapability.get(row.capabilityId) ?? '',
      dueAt: row.dueAt.toISOString(),
    }),
  );
}

export function registerReviewDueRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/review/due', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    try {
      const due = await listDueCapabilities(db, user.id, new Date());
      return { due };
    } catch {
      return reply.code(500).send(databaseUnavailable);
    }
  });
}
