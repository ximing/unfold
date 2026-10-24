import { exportPackageSchema, normalizeName, type ExportPackage } from '@unfold/dto';
import type { PmNode } from '@unfold/doc-schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { createDb } from './db/client.js';
import { collections, documents, domains, knowledgeObjects, relations } from './db/schema.js';
import { saveDocument } from './documents.js';
import type { SessionLookup } from './objects.js';
import { syncObjectIndex } from './services/index-sync.js';

type Database = ReturnType<typeof createDb>;

const unauthenticated = { error: { code: 'unauthenticated', message: '未登录' } };
const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };
const foreignOwner = { error: { code: 'foreign_owner', message: '这个包里的数据和当前用户对不上' } };
const conflict = { error: { code: 'conflict', message: '导入和现有数据重了' } };
const databaseUnavailable = { error: { code: 'database_unavailable', message: '数据库暂时不可用' } };

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  if ('cause' in error) return isUniqueViolation(error.cause);
  return false;
}

function asNode(content: unknown): PmNode | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  if (typeof (content as { type?: unknown }).type !== 'string') return null;
  return content as PmNode;
}

function aliasesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.some((item) => typeof item !== 'string')) return [];
  return value;
}

function orderCollections(rows: ExportPackage['collections']): ExportPackage['collections'] {
  const pending = [...rows];
  const ordered: ExportPackage['collections'] = [];
  const placed = new Set<string>();
  while (pending.length > 0) {
    const ready = pending.filter(
      (row) => row.parentCollectionId === null || placed.has(row.parentCollectionId),
    );
    const batch = ready.length > 0 ? ready : pending.slice(0, 1);
    for (const row of batch) {
      ordered.push(row);
      placed.add(row.id);
    }
    for (const row of batch) {
      const index = pending.indexOf(row);
      if (index >= 0) pending.splice(index, 1);
    }
  }
  return ordered;
}

async function foreignIds(
  db: Database,
  userId: string,
  table: typeof domains | typeof documents | typeof knowledgeObjects | typeof collections | typeof relations,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return false;
  const rows = await db
    .select({ userId: table.userId })
    .from(table)
    .where(inArray(table.id, ids));
  return rows.some((row) => row.userId !== userId);
}

export function registerImportRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/import', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return reply.code(401).send(unauthenticated);

    const parsed = exportPackageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody);
    const pack = parsed.data;

    const nodes: PmNode[] = [];
    for (const doc of pack.documents) {
      const node = asNode(doc.content);
      if (!node) return reply.code(400).send(invalidBody);
      nodes.push(node);
    }

    try {
      if (await foreignIds(db, user.id, domains, pack.domains.map((row) => row.id))) {
        return reply.code(409).send(foreignOwner);
      }
      if (await foreignIds(db, user.id, documents, pack.documents.map((row) => row.id))) {
        return reply.code(409).send(foreignOwner);
      }
      if (await foreignIds(db, user.id, knowledgeObjects, pack.objects.map((row) => row.id))) {
        return reply.code(409).send(foreignOwner);
      }
      if (await foreignIds(db, user.id, collections, pack.collections.map((row) => row.id))) {
        return reply.code(409).send(foreignOwner);
      }
      if (await foreignIds(db, user.id, relations, pack.relations.map((row) => row.id))) {
        return reply.code(409).send(foreignOwner);
      }

      await db.transaction(async (tx) => {
        for (const row of pack.domains) {
          const existing = await tx.select({ id: domains.id }).from(domains).where(eq(domains.id, row.id)).limit(1);
          if (existing[0]) {
            await tx
              .update(domains)
              .set({ name: row.name, deletedAt: null, updatedAt: new Date() })
              .where(and(eq(domains.id, row.id), eq(domains.userId, user.id)));
          } else {
            await tx.insert(domains).values({ id: row.id, userId: user.id, name: row.name });
          }
        }

        for (const row of pack.documents) {
          const existing = await tx
            .select({ id: documents.id })
            .from(documents)
            .where(eq(documents.id, row.id))
            .limit(1);
          if (existing[0]) {
            await tx
              .update(documents)
              .set({
                ownerType: row.ownerType,
                ownerId: row.ownerId,
                deletedAt: null,
                updatedAt: new Date(),
              })
              .where(and(eq(documents.id, row.id), eq(documents.userId, user.id)));
          } else {
            await tx.insert(documents).values({
              id: row.id,
              userId: user.id,
              ownerType: row.ownerType,
              ownerId: row.ownerId,
              schemaVersion: row.schemaVersion,
              contentJson: { type: 'doc', content: [] },
              plainText: '',
            });
          }
        }

        for (const row of pack.objects) {
          const values = {
            domainId: row.domainId,
            type: row.type,
            canonicalName: row.canonicalName,
            normalizedName: normalizeName(row.canonicalName),
            aliases: aliasesOf(row.aliases),
            coreStatement: row.coreStatement,
            coreVersion: row.coreVersion,
            documentId: row.documentId,
            status: row.status,
            deletedAt: null,
            updatedAt: new Date(),
          };
          const existing = await tx
            .select({ id: knowledgeObjects.id })
            .from(knowledgeObjects)
            .where(eq(knowledgeObjects.id, row.id))
            .limit(1);
          if (existing[0]) {
            await tx
              .update(knowledgeObjects)
              .set(values)
              .where(and(eq(knowledgeObjects.id, row.id), eq(knowledgeObjects.userId, user.id)));
          } else {
            await tx.insert(knowledgeObjects).values({ id: row.id, userId: user.id, ...values });
          }
        }

        for (const row of orderCollections(pack.collections)) {
          const values = {
            domainId: row.domainId,
            title: row.title,
            intent: row.intent,
            parentCollectionId: row.parentCollectionId,
            position: row.position,
            documentId: row.documentId,
            deletedAt: null,
            updatedAt: new Date(),
          };
          const existing = await tx
            .select({ id: collections.id })
            .from(collections)
            .where(eq(collections.id, row.id))
            .limit(1);
          if (existing[0]) {
            await tx
              .update(collections)
              .set(values)
              .where(and(eq(collections.id, row.id), eq(collections.userId, user.id)));
          } else {
            await tx.insert(collections).values({ id: row.id, userId: user.id, ...values });
          }
        }

        for (const row of pack.relations) {
          const values = {
            type: row.type,
            fromId: row.fromId,
            toId: row.toId,
            status: row.status,
            origin: row.origin,
            whatChanged: row.whatChanged,
            distinction: row.distinction,
            boundary: row.boundary,
            condition: row.condition,
            note: row.note,
            deletedAt: null,
            updatedAt: new Date(),
          };
          const existing = await tx
            .select({ id: relations.id })
            .from(relations)
            .where(eq(relations.id, row.id))
            .limit(1);
          if (existing[0]) {
            await tx
              .update(relations)
              .set(values)
              .where(and(eq(relations.id, row.id), eq(relations.userId, user.id)));
          } else {
            await tx.insert(relations).values({ id: row.id, userId: user.id, ...values });
          }
        }
      });

      for (let index = 0; index < pack.documents.length; index += 1) {
        const doc = pack.documents[index];
        const node = nodes[index];
        if (!doc || !node) continue;
        await saveDocument(db, user.id, doc.id, node, doc.plainText);
      }
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(conflict);
      return reply.code(500).send(databaseUnavailable);
    }

    for (const doc of pack.documents) {
      if (doc.ownerType !== 'object') continue;
      await syncObjectIndex(db, user.id, doc.ownerId);
    }

    return reply.code(200).send({ ok: true });
  });
}
