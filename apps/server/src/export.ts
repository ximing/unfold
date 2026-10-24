import { documentToMarkdown, getBlockType, type PmNode } from '@unfold/doc-schema';
import { exportPackageSchema } from '@unfold/dto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { createDb } from './db/client.js';
import { collections, documents, domains, knowledgeObjects, relations } from './db/schema.js';
import type { SessionLookup } from './objects.js';

type Database = ReturnType<typeof createDb>;

function isDoc(content: unknown): content is { type: 'doc'; content: unknown[] } {
  if (typeof content !== 'object' || content === null) return false;
  const record = content as { type?: unknown; content?: unknown };
  return record.type === 'doc' && Array.isArray(record.content);
}

function blockMarkdown(block: unknown): string {
  if (typeof block !== 'object' || block === null) return '';
  const node = block as PmNode;
  const spec = typeof node.type === 'string' ? getBlockType(node.type) : undefined;
  if (spec) return spec.toMarkdown(node);
  return documentToMarkdown({ type: 'doc', content: [node] });
}

export function exportDocumentMarkdown(content: unknown): string {
  if (!isDoc(content)) return '';
  const parts: string[] = [];
  for (const block of content.content) {
    const markdown = blockMarkdown(block);
    if (markdown !== '') parts.push(markdown);
  }
  return parts.join('\n\n');
}

function exportAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const aliases: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return [];
    aliases.push(item);
  }
  return aliases;
}

export function registerExportRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/export', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const [domainRows, objectRows, documentRows, relationRows, collectionRows] = await Promise.all([
      db
        .select({ id: domains.id, name: domains.name })
        .from(domains)
        .where(and(eq(domains.userId, user.id), isNull(domains.deletedAt))),
      db
        .select({
          id: knowledgeObjects.id,
          domainId: knowledgeObjects.domainId,
          type: knowledgeObjects.type,
          canonicalName: knowledgeObjects.canonicalName,
          coreStatement: knowledgeObjects.coreStatement,
          aliases: knowledgeObjects.aliases,
          coreVersion: knowledgeObjects.coreVersion,
          documentId: knowledgeObjects.documentId,
          status: knowledgeObjects.status,
        })
        .from(knowledgeObjects)
        .where(and(eq(knowledgeObjects.userId, user.id), isNull(knowledgeObjects.deletedAt))),
      db
        .select({
          id: documents.id,
          ownerType: documents.ownerType,
          ownerId: documents.ownerId,
          schemaVersion: documents.schemaVersion,
          content: documents.contentJson,
          plainText: documents.plainText,
        })
        .from(documents)
        .where(and(eq(documents.userId, user.id), isNull(documents.deletedAt))),
      db
        .select({
          id: relations.id,
          type: relations.type,
          fromId: relations.fromId,
          toId: relations.toId,
          status: relations.status,
          origin: relations.origin,
          whatChanged: relations.whatChanged,
          distinction: relations.distinction,
          boundary: relations.boundary,
          condition: relations.condition,
          note: relations.note,
        })
        .from(relations)
        .where(and(eq(relations.userId, user.id), isNull(relations.deletedAt))),
      db
        .select({
          id: collections.id,
          domainId: collections.domainId,
          title: collections.title,
          intent: collections.intent,
          parentCollectionId: collections.parentCollectionId,
          position: collections.position,
          documentId: collections.documentId,
        })
        .from(collections)
        .where(and(eq(collections.userId, user.id), isNull(collections.deletedAt))),
    ]);

    const body = exportPackageSchema.parse({
      format: 'unfold-export',
      version: 1,
      domains: domainRows,
      objects: objectRows.map((row) => ({
        id: row.id,
        domainId: row.domainId,
        type: row.type,
        canonicalName: row.canonicalName,
        coreStatement: row.coreStatement,
        aliases: exportAliases(row.aliases),
        coreVersion: row.coreVersion,
        documentId: row.documentId,
        status: row.status,
      })),
      documents: documentRows.map((row) => ({
        id: row.id,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        schemaVersion: row.schemaVersion,
        content: row.content,
        plainText: row.plainText,
        markdown: exportDocumentMarkdown(row.content),
      })),
      relations: relationRows,
      collections: collectionRows,
    });

    reply.header('Content-Disposition', 'attachment; filename="unfold-export.json"');
    return reply.code(200).send(body);
  });
}
