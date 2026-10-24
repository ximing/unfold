import { relationTypeSchema, type RelationType } from '@unfold/dto';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import { knowledgeObjects, relations } from './db/schema.js';
import type { SessionLookup } from './objects.js';
import { layoutGraph, type GraphNeighbor, type GraphSector } from './services/graph.js';
import { sectorFor } from './services/relation-rules.js';

type Database = ReturnType<typeof createDb>;

const objectNotFound = { error: { code: 'not_found', message: '没有这个点' } };

const objectTypeSchema = z.enum(['concept', 'principle', 'method', 'model', 'problem']);

const labels: Record<RelationType, string> = {
  evolves_from: '演化',
  prerequisite: '前置',
  applies: '应用',
  implements: '实现',
  contrasts: '对比',
  analogous: '类比',
  variant: '变体',
  fails_when: '失效',
};

const graphNodeSchema = z.object({
  id: z.uuid(),
  canonicalName: z.string(),
  coreStatement: z.string(),
  type: objectTypeSchema,
  x: z.number(),
  y: z.number(),
});

const graphEdgeSchema = z.object({
  fromId: z.uuid(),
  toId: z.uuid(),
  type: relationTypeSchema,
  label: z.string(),
});

export const graphResponseSchema = z.object({
  truncated: z.boolean(),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

type KeptNeighbor = {
  neighborId: string;
  type: RelationType;
  sector: GraphSector;
};

export function registerGraphRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/objects/:id/graph', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(objectNotFound);

    const focusRows = await db
      .select({
        id: knowledgeObjects.id,
        canonicalName: knowledgeObjects.canonicalName,
        coreStatement: knowledgeObjects.coreStatement,
        type: knowledgeObjects.type,
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
    const focus = focusRows[0];
    if (!focus) return reply.code(404).send(objectNotFound);

    const relationRows = await db
      .select({
        id: relations.id,
        fromId: relations.fromId,
        toId: relations.toId,
        type: relations.type,
      })
      .from(relations)
      .where(
        and(
          eq(relations.userId, user.id),
          eq(relations.status, 'accepted'),
          isNull(relations.deletedAt),
          or(eq(relations.fromId, focus.id), eq(relations.toId, focus.id)),
        ),
      )
      .orderBy(asc(relations.createdAt), asc(relations.id));

    const seen = new Set<string>();
    const kept: KeptNeighbor[] = [];
    for (const row of relationRows) {
      const parsedType = relationTypeSchema.safeParse(row.type);
      if (!parsedType.success) continue;
      const sector = sectorFor(focus.id, {
        fromId: row.fromId,
        toId: row.toId,
        type: parsedType.data,
      });
      if (!sector) continue;
      const neighborId = row.fromId === focus.id ? row.toId : row.fromId;
      if (seen.has(neighborId)) continue;
      seen.add(neighborId);
      kept.push({ neighborId, type: parsedType.data, sector });
    }

    const neighborIds = kept.map((item) => item.neighborId);
    const neighborRows =
      neighborIds.length === 0
        ? []
        : await db
            .select({
              id: knowledgeObjects.id,
              canonicalName: knowledgeObjects.canonicalName,
              coreStatement: knowledgeObjects.coreStatement,
              type: knowledgeObjects.type,
            })
            .from(knowledgeObjects)
            .where(
              and(
                eq(knowledgeObjects.userId, user.id),
                eq(knowledgeObjects.status, 'active'),
                isNull(knowledgeObjects.deletedAt),
                inArray(knowledgeObjects.id, neighborIds),
              ),
            );
    const points = new Map(neighborRows.map((row) => [row.id, row]));

    const neighbors: GraphNeighbor[] = [];
    const relationByNeighbor = new Map<string, RelationType>();
    for (const item of kept) {
      const point = points.get(item.neighborId);
      if (!point) continue;
      neighbors.push({
        id: point.id,
        sector: item.sector,
        canonicalName: point.canonicalName,
        coreStatement: point.coreStatement,
      });
      relationByNeighbor.set(point.id, item.type);
    }

    const layout = layoutGraph(
      {
        id: focus.id,
        canonicalName: focus.canonicalName,
        coreStatement: focus.coreStatement,
      },
      neighbors,
    );

    const typeById = new Map<string, z.infer<typeof objectTypeSchema>>([
      [focus.id, objectTypeSchema.parse(focus.type)],
    ]);
    for (const point of points.values()) typeById.set(point.id, objectTypeSchema.parse(point.type));

    const nodes = layout.nodes.map((node) => {
      const type = typeById.get(node.id);
      if (!type) throw new Error('graph point missing');
      return {
        id: node.id,
        canonicalName: node.canonicalName,
        coreStatement: node.coreStatement,
        type,
        x: node.x,
        y: node.y,
      };
    });
    const edges = layout.edges.map((edge) => {
      const type = relationByNeighbor.get(edge.toId);
      if (!type) throw new Error('graph relation missing');
      return { fromId: edge.fromId, toId: edge.toId, type, label: labels[type] };
    });

    return reply.code(200).send(graphResponseSchema.parse({ truncated: layout.truncated, nodes, edges }));
  });
}
