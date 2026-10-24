import { SCHEMA_VERSION } from '@unfold/doc-schema';
import {
  createDomainBodySchema,
  createObjectBodySchema,
  domainListSchema,
  domainSchema,
  normalizeName,
  objectSummarySchema,
  updateObjectBodySchema,
  type ObjectSummary,
} from '@unfold/dto';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { blockIndex, domains, documents, knowledgeObjects, relations } from './db/schema.js';
import { syncObjectIndex } from './services/index-sync.js';

type Database = ReturnType<typeof createDb>;

export type SessionUser = { id: string; username: string };

export type SessionLookup = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<SessionUser | undefined>;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const domainNotFound = { error: { code: 'not_found', message: '没有这个领域' } };
const objectNotFound = { error: { code: 'not_found', message: '没有这个点' } };
const duplicateDomain = { error: { code: 'duplicate_name', message: '已经有这个领域' } };
const duplicateObject = { error: { code: 'duplicate_name', message: '这个领域里已经有同名的点' } };
const duplicateAlias = { error: { code: 'duplicate_alias', message: '这个称呼已经指向另一个点' } };

const KNOWLEDGE_TYPES = ['concept', 'principle', 'method', 'model', 'problem'] as const;

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  if ('cause' in error) return isUniqueViolation(error.cause);
  return false;
}

function asAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function isKnowledgeType(value: string): value is ObjectSummary['type'] {
  return (KNOWLEDGE_TYPES as readonly string[]).includes(value);
}

async function summaries(
  db: Database,
  userId: string,
  filter: { objectId?: string; domainId?: string },
): Promise<ObjectSummary[]> {
  const filters = [
    eq(knowledgeObjects.userId, userId),
    eq(knowledgeObjects.status, 'active'),
    isNull(knowledgeObjects.deletedAt),
    isNull(domains.deletedAt),
  ];
  if (filter.objectId) filters.push(eq(knowledgeObjects.id, filter.objectId));
  if (filter.domainId) filters.push(eq(knowledgeObjects.domainId, filter.domainId));

  const rows = await db
    .select({
      id: knowledgeObjects.id,
      type: knowledgeObjects.type,
      domainId: knowledgeObjects.domainId,
      domainName: domains.name,
      canonicalName: knowledgeObjects.canonicalName,
      normalizedName: knowledgeObjects.normalizedName,
      coreStatement: knowledgeObjects.coreStatement,
      coreVersion: knowledgeObjects.coreVersion,
      status: knowledgeObjects.status,
      aliases: knowledgeObjects.aliases,
      createdAt: knowledgeObjects.createdAt,
    })
    .from(knowledgeObjects)
    .innerJoin(domains, eq(knowledgeObjects.domainId, domains.id))
    .where(and(...filters))
    .orderBy(asc(knowledgeObjects.createdAt));

  return rows.map((row) => {
    if (!isKnowledgeType(row.type)) throw new Error('unexpected object type');
    if (row.status !== 'active' && row.status !== 'merged') throw new Error('unexpected object status');
    return objectSummarySchema.parse({
      id: row.id,
      type: row.type,
      domainId: row.domainId,
      domainName: row.domainName,
      canonicalName: row.canonicalName,
      normalizedName: row.normalizedName,
      coreStatement: row.coreStatement,
      coreVersion: row.coreVersion,
      status: row.status,
      aliases: asAliases(row.aliases),
    });
  });
}

async function ownedDomain(db: Database, userId: string, domainId: string) {
  const found = await db
    .select({ id: domains.id, name: domains.name })
    .from(domains)
    .where(and(eq(domains.id, domainId), eq(domains.userId, userId), isNull(domains.deletedAt)))
    .limit(1);
  return found[0] ?? null;
}

export function registerObjectRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/domains', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createDomainBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    try {
      const inserted = await db
        .insert(domains)
        .values({ userId: user.id, name: parsed.data.name })
        .returning({ id: domains.id, name: domains.name });
      const row = inserted[0];
      if (!row) throw new Error('insert domain failed');
      return reply.code(201).send(domainSchema.parse({ id: row.id, name: row.name, freeCount: 0 }));
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(duplicateDomain);
      throw error;
    }
  });

  app.get('/api/domains', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const result = await db.execute<{ id: string; name: string; free_count: string }>(sql`
      select d.id, d.name, count(o.id)::text as free_count
      from domains d
      left join knowledge_objects o
        on o.domain_id = d.id
       and o.user_id = d.user_id
       and o.status = 'active'
       and o.deleted_at is null
      where d.user_id = ${user.id}
        and d.deleted_at is null
      group by d.id
      order by d.created_at asc
    `);

    const body = domainListSchema.parse({
      domains: result.rows.map((row) =>
        domainSchema.parse({
          id: row.id,
          name: row.name,
          freeCount: Number(row.free_count),
        }),
      ),
    });
    return reply.code(200).send(body);
  });

  app.post('/api/objects', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createObjectBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const domain = await ownedDomain(db, user.id, parsed.data.domainId);
    if (!domain) return reply.code(404).send(domainNotFound);

    try {
      const objectId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(knowledgeObjects)
          .values({
            userId: user.id,
            type: parsed.data.type,
            domainId: parsed.data.domainId,
            canonicalName: parsed.data.canonicalName,
            normalizedName: normalizeName(parsed.data.canonicalName),
            aliases: [],
            coreStatement: parsed.data.coreStatement,
          })
          .returning({ id: knowledgeObjects.id });
        const created = inserted[0];
        if (!created) throw new Error('insert object failed');

        const docs = await tx
          .insert(documents)
          .values({
            userId: user.id,
            ownerType: 'object',
            ownerId: created.id,
            schemaVersion: SCHEMA_VERSION,
            contentJson: { type: 'doc', content: [] },
            plainText: '',
          })
          .returning({ id: documents.id });
        const document = docs[0];
        if (!document) throw new Error('insert document failed');

        await tx
          .update(knowledgeObjects)
          .set({ documentId: document.id, updatedAt: new Date() })
          .where(eq(knowledgeObjects.id, created.id));

        return created.id;
      });

      await syncObjectIndex(db, user.id, objectId);
      const summary = await summaries(db, user.id, { objectId });
      const one = summary[0];
      if (!one) return reply.code(404).send(objectNotFound);
      return reply.code(201).send(one);
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(duplicateObject);
      throw error;
    }
  });

  app.get('/api/objects', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = z.object({ domainId: z.uuid() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const domain = await ownedDomain(db, user.id, parsed.data.domainId);
    if (!domain) return reply.code(404).send(domainNotFound);

    const objects = await summaries(db, user.id, { domainId: parsed.data.domainId });
    return reply.code(200).send({ objects });
  });

  app.get('/api/objects/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(objectNotFound);

    const summary = await summaries(db, user.id, { objectId: params.data.id });
    const one = summary[0];
    if (!one) return reply.code(404).send(objectNotFound);
    return reply.code(200).send(one);
  });

  app.patch('/api/objects/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(objectNotFound);

    const parsed = updateObjectBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const currentRows = await db
      .select({
        id: knowledgeObjects.id,
        domainId: knowledgeObjects.domainId,
        canonicalName: knowledgeObjects.canonicalName,
        normalizedName: knowledgeObjects.normalizedName,
        coreStatement: knowledgeObjects.coreStatement,
        coreVersion: knowledgeObjects.coreVersion,
        aliases: knowledgeObjects.aliases,
      })
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
    const current = currentRows[0];
    if (!current) return reply.code(404).send(objectNotFound);

    const nextCanonical = parsed.data.canonicalName ?? current.canonicalName;
    const nextNormalized = normalizeName(nextCanonical);
    const nextStatement = parsed.data.coreStatement ?? current.coreStatement;
    const nextAliases = parsed.data.aliases ?? asAliases(current.aliases);
    const normalizedAliases = nextAliases.map((alias) => normalizeName(alias));

    if (nextNormalized !== current.normalizedName) {
      const clash = await db
        .select({ id: knowledgeObjects.id })
        .from(knowledgeObjects)
        .where(
          and(
            eq(knowledgeObjects.userId, user.id),
            eq(knowledgeObjects.domainId, current.domainId),
            eq(knowledgeObjects.normalizedName, nextNormalized),
            eq(knowledgeObjects.status, 'active'),
            isNull(knowledgeObjects.deletedAt),
          ),
        )
        .limit(1);
      if (clash[0]) return reply.code(409).send(duplicateObject);
    }

    if (new Set(normalizedAliases).size !== normalizedAliases.length) {
      return reply.code(409).send(duplicateAlias);
    }
    if (normalizedAliases.includes(nextNormalized)) {
      return reply.code(409).send(duplicateAlias);
    }

    const others = await db
      .select({
        id: knowledgeObjects.id,
        normalizedName: knowledgeObjects.normalizedName,
        aliases: knowledgeObjects.aliases,
      })
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.userId, user.id),
          eq(knowledgeObjects.status, 'active'),
          isNull(knowledgeObjects.deletedAt),
        ),
      );
    const taken = new Set<string>();
    for (const other of others) {
      if (other.id === current.id) continue;
      taken.add(other.normalizedName);
      for (const alias of asAliases(other.aliases)) taken.add(normalizeName(alias));
    }

    if (normalizedAliases.some((alias) => taken.has(alias))) {
      return reply.code(409).send(duplicateAlias);
    }

    const nameChanged = nextCanonical !== current.canonicalName;
    const statementChanged = nextStatement !== current.coreStatement;
    const nextVersion =
      nameChanged || statementChanged ? current.coreVersion + 1 : current.coreVersion;

    try {
      await db
        .update(knowledgeObjects)
        .set({
          canonicalName: nextCanonical,
          normalizedName: nextNormalized,
          coreStatement: nextStatement,
          coreVersion: nextVersion,
          aliases: nextAliases,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeObjects.id, current.id));
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(duplicateObject);
      throw error;
    }

    await syncObjectIndex(db, user.id, current.id);
    const summary = await summaries(db, user.id, { objectId: current.id });
    const one = summary[0];
    if (!one) return reply.code(404).send(objectNotFound);
    return reply.code(200).send(one);
  });

  app.delete('/api/objects/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(objectNotFound);

    const found = await db
      .select({ id: knowledgeObjects.id, documentId: knowledgeObjects.documentId })
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
    const current = found[0];
    if (!current) return reply.code(404).send(objectNotFound);

    const refFilters = [
      eq(blockIndex.blockType, 'object_ref'),
      eq(blockIndex.textPreview, current.id),
      isNull(blockIndex.deletedAt),
      isNull(documents.deletedAt),
      eq(documents.userId, user.id),
    ];
    // 自己的文档里引用自己不算。
    if (current.documentId) refFilters.push(ne(documents.id, current.documentId));

    const counted = await db
      .select({ count: sql<string>`count(*)::text` })
      .from(blockIndex)
      .innerJoin(documents, eq(blockIndex.documentId, documents.id))
      .where(and(...refFilters));
    const refCount = Number(counted[0]?.count ?? 0);

    const linked = await db
      .select({ count: sql<string>`count(*)::text` })
      .from(relations)
      .where(
        and(
          eq(relations.userId, user.id),
          eq(relations.status, 'accepted'),
          isNull(relations.deletedAt),
          or(eq(relations.fromId, current.id), eq(relations.toId, current.id)),
        ),
      );
    const relationCount = Number(linked[0]?.count ?? 0);
    const count = refCount + relationCount;
    if (count > 0) {
      return reply.code(409).send({
        error: { code: 'referenced', message: `还有 ${count} 处引用这个点`, count },
      });
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(knowledgeObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(knowledgeObjects.id, current.id));
      if (current.documentId) {
        await tx
          .update(documents)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(documents.id, current.documentId));
      }
    });
    await syncObjectIndex(db, user.id, current.id);
    return reply.code(204).send();
  });
}
