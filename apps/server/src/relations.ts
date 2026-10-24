import {
  createRelationBodySchema,
  fanRelationListSchema,
  fanRelationSchema,
  relationSchema,
  relationStatusSchema,
  relationTypeSchema,
  updateRelationStatusSchema,
} from '@unfold/dto';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { knowledgeObjects, relations } from './db/schema.js';
import type { SessionLookup } from './objects.js';
import {
  canTransition,
  needsCrossDomainConfirm,
  sectorFor,
  validateRelation,
} from './services/relation-rules.js';

type Database = ReturnType<typeof createDb>;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const objectNotFound = { error: { code: 'not_found', message: '没有这个点' } };
const relationNotFound = { error: { code: 'not_found', message: '没有这条连接' } };
const duplicateRelation = {
  error: { code: 'duplicate_relation', message: '这两个点之间已经有这条对照' },
};
const invalidTransition = {
  error: { code: 'invalid_transition', message: '这条连接不能再改状态' },
};

const fromPoint = alias(knowledgeObjects, 'relation_from');
const toPoint = alias(knowledgeObjects, 'relation_to');

const relationColumns = {
  id: relations.id,
  fromId: relations.fromId,
  toId: relations.toId,
  type: relations.type,
  distinction: relations.distinction,
  whatChanged: relations.whatChanged,
  condition: relations.condition,
  boundary: relations.boundary,
  note: relations.note,
  status: relations.status,
  origin: relations.origin,
};

type RelationRow = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  distinction: string;
  whatChanged: string;
  condition: string;
  boundary: string;
  note: string;
  status: string;
  origin: string;
};

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  if ('cause' in error) return isUniqueViolation(error.cause);
  return false;
}

function blank(value: string | undefined): string {
  return value ?? '';
}

function presentRelation(row: RelationRow, sameDomain: boolean) {
  const type = relationTypeSchema.parse(row.type);
  return relationSchema.parse({
    id: row.id,
    fromId: row.fromId,
    toId: row.toId,
    type,
    distinction: row.distinction,
    whatChanged: row.whatChanged,
    condition: row.condition,
    boundary: row.boundary,
    note: row.note,
    status: row.status,
    origin: row.origin,
    needsCrossDomainConfirm: needsCrossDomainConfirm(type, sameDomain),
  });
}

async function activeOwnedPoints(db: Database, userId: string, fromId: string, toId: string) {
  const rows = await db
    .select({ id: knowledgeObjects.id, domainId: knowledgeObjects.domainId })
    .from(knowledgeObjects)
    .where(
      and(
        eq(knowledgeObjects.userId, userId),
        eq(knowledgeObjects.status, 'active'),
        isNull(knowledgeObjects.deletedAt),
        inArray(knowledgeObjects.id, [fromId, toId]),
      ),
    );
  if (rows.length !== 2) return null;
  const domainsById = new Map(rows.map((row) => [row.id, row.domainId]));
  const fromDomainId = domainsById.get(fromId);
  const toDomainId = domainsById.get(toId);
  if (fromDomainId === undefined || toDomainId === undefined) return null;
  return { fromDomainId, toDomainId };
}

export function registerRelationRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/relations', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createRelationBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const validated = validateRelation(parsed.data);
    if (!validated.ok) {
      return reply.code(400).send({ error: { code: validated.code, message: validated.message } });
    }

    const points = await activeOwnedPoints(db, user.id, parsed.data.fromId, parsed.data.toId);
    if (!points) return reply.code(404).send(objectNotFound);

    try {
      const inserted = await db
        .insert(relations)
        .values({
          userId: user.id,
          fromId: parsed.data.fromId,
          toId: parsed.data.toId,
          type: parsed.data.type,
          distinction: blank(parsed.data.distinction),
          whatChanged: blank(parsed.data.whatChanged),
          condition: blank(parsed.data.condition),
          boundary: blank(parsed.data.boundary),
          note: blank(parsed.data.note),
          status: 'accepted',
          origin: 'user',
        })
        .returning(relationColumns);
      const row = inserted[0];
      if (!row) throw new Error('insert relation failed');
      return reply.code(201).send(presentRelation(row, points.fromDomainId === points.toDomainId));
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(duplicateRelation);
      throw error;
    }
  });

  app.patch('/api/relations/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(relationNotFound);

    const parsed = updateRelationStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const found = await db
      .select({
        ...relationColumns,
        fromDomainId: fromPoint.domainId,
        toDomainId: toPoint.domainId,
      })
      .from(relations)
      .innerJoin(fromPoint, eq(relations.fromId, fromPoint.id))
      .innerJoin(toPoint, eq(relations.toId, toPoint.id))
      .where(
        and(eq(relations.id, params.data.id), eq(relations.userId, user.id), isNull(relations.deletedAt)),
      )
      .limit(1);
    const current = found[0];
    if (!current) return reply.code(404).send(relationNotFound);

    const currentStatus = relationStatusSchema.parse(current.status);
    if (!canTransition(currentStatus, parsed.data.status)) {
      return reply.code(409).send(invalidTransition);
    }

    const updated = await db
      .update(relations)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(relations.id, current.id), eq(relations.userId, user.id), isNull(relations.deletedAt)))
      .returning(relationColumns);
    const row = updated[0];
    if (!row) return reply.code(404).send(relationNotFound);
    return reply.code(200).send(presentRelation(row, current.fromDomainId === current.toDomainId));
  });

  app.get('/api/objects/:id/relations', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(objectNotFound);

    const owned = await db
      .select({ id: knowledgeObjects.id })
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.id, params.data.id),
          eq(knowledgeObjects.userId, user.id),
          eq(knowledgeObjects.status, 'active'),
          isNull(knowledgeObjects.deletedAt),
        ),
      )
      .limit(1);
    if (!owned[0]) return reply.code(404).send(objectNotFound);

    const rows = await db
      .select({
        ...relationColumns,
        fromDomainId: fromPoint.domainId,
        toDomainId: toPoint.domainId,
        fromName: fromPoint.canonicalName,
        toName: toPoint.canonicalName,
        fromCore: fromPoint.coreStatement,
        toCore: toPoint.coreStatement,
      })
      .from(relations)
      .innerJoin(fromPoint, eq(relations.fromId, fromPoint.id))
      .innerJoin(toPoint, eq(relations.toId, toPoint.id))
      .where(
        and(
          eq(relations.userId, user.id),
          eq(relations.status, 'accepted'),
          isNull(relations.deletedAt),
          or(eq(relations.fromId, params.data.id), eq(relations.toId, params.data.id)),
        ),
      )
      .orderBy(asc(relations.createdAt));

    const listed = [];
    for (const row of rows) {
      const type = relationTypeSchema.parse(row.type);
      const sector = sectorFor(params.data.id, { fromId: row.fromId, toId: row.toId, type });
      if (sector === null) continue;
      const otherIsTo = row.fromId === params.data.id;
      listed.push(
        fanRelationSchema.parse({
          ...presentRelation(row, row.fromDomainId === row.toDomainId),
          sector,
          otherId: otherIsTo ? row.toId : row.fromId,
          otherName: otherIsTo ? row.toName : row.fromName,
          otherCore: otherIsTo ? row.toCore : row.fromCore,
        }),
      );
    }
    return reply.code(200).send(fanRelationListSchema.parse({ relations: listed }));
  });
}
