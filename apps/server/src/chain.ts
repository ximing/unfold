import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { knowledgeObjects, relations } from './db/schema.js';
import type { SessionLookup } from './objects.js';
import { buildChain, layoutChain, type ChainEdge } from './services/chain.js';

type Database = ReturnType<typeof createDb>;

const objectNotFound = { error: { code: 'not_found', message: '没有这个点' } };

const chainNodeSchema = z.object({
  id: z.uuid(),
  canonicalName: z.string(),
  coreStatement: z.string(),
  x: z.number(),
  y: z.number(),
});

const chainLinkSchema = z.object({
  fromId: z.uuid(),
  toId: z.uuid(),
  whatChanged: z.string(),
});

export const chainResponseSchema = z.object({
  chains: z.array(
    z.object({
      type: z.enum(['evolves_from', 'variant']),
      nodes: z.array(chainNodeSchema),
      edges: z.array(chainLinkSchema),
    }),
  ),
});

function chainType(value: string): ChainEdge['type'] | null {
  if (value === 'evolves_from' || value === 'variant') return value;
  return null;
}

export function registerChainRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/objects/:id/chain', async (request, reply) => {
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

    const edgeRows = await db
      .select({
        id: relations.id,
        fromId: relations.fromId,
        toId: relations.toId,
        type: relations.type,
        whatChanged: relations.whatChanged,
        createdAt: relations.createdAt,
      })
      .from(relations)
      .where(
        and(
          eq(relations.userId, user.id),
          eq(relations.status, 'accepted'),
          isNull(relations.deletedAt),
          inArray(relations.type, ['evolves_from', 'variant']),
        ),
      );

    const endpointIds = [...new Set(edgeRows.flatMap((row) => [row.fromId, row.toId]))];
    const pointRows =
      endpointIds.length === 0
        ? []
        : await db
            .select({
              id: knowledgeObjects.id,
              canonicalName: knowledgeObjects.canonicalName,
              coreStatement: knowledgeObjects.coreStatement,
            })
            .from(knowledgeObjects)
            .where(
              and(
                eq(knowledgeObjects.userId, user.id),
                isNull(knowledgeObjects.deletedAt),
                inArray(knowledgeObjects.id, endpointIds),
              ),
            );
    const points = new Map(pointRows.map((row) => [row.id, row]));

    const usable: ChainEdge[] = [];
    for (const row of edgeRows) {
      const type = chainType(row.type);
      if (!type) continue;
      if (!points.has(row.fromId) || !points.has(row.toId)) continue;
      usable.push({
        id: row.id,
        fromId: row.fromId,
        toId: row.toId,
        type,
        whatChanged: row.whatChanged,
        createdAt: row.createdAt,
      });
    }

    const chains = buildChain(params.data.id, usable).map((chain) => ({
      type: chain.type,
      nodes: layoutChain(chain.nodeIds).map((node) => {
        const point = points.get(node.id);
        if (!point) throw new Error('chain point missing');
        return {
          id: node.id,
          canonicalName: point.canonicalName,
          coreStatement: point.coreStatement,
          x: node.x,
          y: node.y,
        };
      }),
      edges: chain.edges,
    }));

    return reply.code(200).send(chainResponseSchema.parse({ chains }));
  });
}
