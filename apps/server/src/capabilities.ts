import { capabilitySchema, createCapabilityBodySchema } from '@unfold/dto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { capabilities, capabilityObjects, knowledgeObjects } from './db/schema.js';
import type { SessionLookup } from './objects.js';

type Database = ReturnType<typeof createDb>;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const objectNotFound = { error: { code: 'not_found', message: '没有这个点' } };
const databaseUnavailable = { error: { code: 'database_unavailable', message: '数据库暂时不可用' } };

const capabilityQuerySchema = z.object({ objectId: z.uuid() });

type CapabilityRow = {
  id: string;
  statement: string;
  kind: string;
  prompt: string;
  hints: unknown;
  hintThreshold: number;
  referenceNote: string;
  primaryObjectId: string;
};

function uniqueIds(primaryObjectId: string, extras: string[]): string[] {
  const ids = [primaryObjectId];
  for (const id of extras) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function hintList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function orderedObjectIds(primaryObjectId: string, ids: string[]): string[] {
  return [primaryObjectId, ...ids.filter((id) => id !== primaryObjectId)];
}

function present(row: CapabilityRow, objectIds: string[]) {
  return capabilitySchema.parse({
    id: row.id,
    statement: row.statement,
    kind: row.kind,
    prompt: row.prompt,
    hints: hintList(row.hints),
    hintThreshold: row.hintThreshold,
    referenceNote: row.referenceNote,
    primaryObjectId: row.primaryObjectId,
    objectIds: orderedObjectIds(row.primaryObjectId, objectIds),
  });
}

async function linksByCapability(db: Database, userId: string, capabilityIds: string[]) {
  const grouped = new Map<string, string[]>();
  if (capabilityIds.length === 0) return grouped;
  const links = await db
    .select({
      capabilityId: capabilityObjects.capabilityId,
      objectId: capabilityObjects.objectId,
    })
    .from(capabilityObjects)
    .where(
      and(
        inArray(capabilityObjects.capabilityId, capabilityIds),
        eq(capabilityObjects.userId, userId),
        isNull(capabilityObjects.deletedAt),
      ),
    )
    .orderBy(asc(capabilityObjects.createdAt), asc(capabilityObjects.id));
  for (const link of links) {
    const list = grouped.get(link.capabilityId) ?? [];
    list.push(link.objectId);
    grouped.set(link.capabilityId, list);
  }
  return grouped;
}

async function listForObject(db: Database, userId: string, objectId: string) {
  const primaryRows = await db
    .select({
      id: capabilities.id,
      statement: capabilities.statement,
      kind: capabilities.kind,
      prompt: capabilities.prompt,
      hints: capabilities.hints,
      hintThreshold: capabilities.hintThreshold,
      referenceNote: capabilities.referenceNote,
      primaryObjectId: capabilities.primaryObjectId,
      createdAt: capabilities.createdAt,
    })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.userId, userId),
        eq(capabilities.primaryObjectId, objectId),
        isNull(capabilities.deletedAt),
      ),
    );
  const linkRows = await db
    .select({ capabilityId: capabilityObjects.capabilityId })
    .from(capabilityObjects)
    .where(
      and(
        eq(capabilityObjects.userId, userId),
        eq(capabilityObjects.objectId, objectId),
        isNull(capabilityObjects.deletedAt),
      ),
    );
  const seen = new Set(primaryRows.map((row) => row.id));
  const extraIds = linkRows.map((row) => row.capabilityId).filter((id) => !seen.has(id));
  const extraRows =
    extraIds.length === 0
      ? []
      : await db
          .select({
            id: capabilities.id,
            statement: capabilities.statement,
            kind: capabilities.kind,
            prompt: capabilities.prompt,
            hints: capabilities.hints,
            hintThreshold: capabilities.hintThreshold,
            referenceNote: capabilities.referenceNote,
            primaryObjectId: capabilities.primaryObjectId,
            createdAt: capabilities.createdAt,
          })
          .from(capabilities)
          .where(
            and(inArray(capabilities.id, extraIds), eq(capabilities.userId, userId), isNull(capabilities.deletedAt)),
          );
  const rows = [...primaryRows, ...extraRows].sort((a, b) => {
    const time = a.createdAt.getTime() - b.createdAt.getTime();
    if (time !== 0) return time;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  const grouped = await linksByCapability(
    db,
    userId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => present(row, grouped.get(row.id) ?? []));
}

export function registerCapabilityRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/capabilities', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createCapabilityBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    try {
      const outcome = await db.transaction(async (tx) => {
        const objectIds = uniqueIds(parsed.data.primaryObjectId, parsed.data.objectIds);
        const found = await tx
          .select({ id: knowledgeObjects.id })
          .from(knowledgeObjects)
          .where(
            and(
              inArray(knowledgeObjects.id, objectIds),
              eq(knowledgeObjects.userId, user.id),
              isNull(knowledgeObjects.deletedAt),
            ),
          );
        if (found.length !== objectIds.length) return null;
        const inserted = await tx
          .insert(capabilities)
          .values({
            userId: user.id,
            statement: parsed.data.statement,
            kind: parsed.data.kind,
            prompt: parsed.data.prompt,
            hints: parsed.data.hints,
            hintThreshold: parsed.data.hintThreshold,
            referenceNote: parsed.data.referenceNote,
            primaryObjectId: parsed.data.primaryObjectId,
          })
          .returning({
            id: capabilities.id,
            statement: capabilities.statement,
            kind: capabilities.kind,
            prompt: capabilities.prompt,
            hints: capabilities.hints,
            hintThreshold: capabilities.hintThreshold,
            referenceNote: capabilities.referenceNote,
            primaryObjectId: capabilities.primaryObjectId,
          });
        const created = inserted[0];
        if (!created) throw new Error('insert capability failed');
        await tx.insert(capabilityObjects).values(
          objectIds.map((objectId) => ({
            userId: user.id,
            capabilityId: created.id,
            objectId,
          })),
        );
        return present(created, objectIds);
      });
      if (!outcome) return reply.code(404).send(objectNotFound);
      return reply.code(201).send(outcome);
    } catch {
      return reply.code(500).send(databaseUnavailable);
    }
  });

  app.get('/api/capabilities', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = capabilityQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    try {
      const list = await listForObject(db, user.id, parsed.data.objectId);
      return { capabilities: list };
    } catch {
      return reply.code(500).send(databaseUnavailable);
    }
  });
}
